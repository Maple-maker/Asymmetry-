import type { Request, Response } from "express";
import { z } from "zod";

import {
  getAccountPositions,
  isSnapTradeConfigured,
  listAccounts,
  type SnapTradePosition,
} from "./snaptrade.js";
import { getServiceClient, isSupabaseConfigured } from "./supabase.js";

/**
 * M2 — SnapTrade positions ingest (READ-ONLY brokerage portfolio tracking).
 *
 * Flow: /v1/snaptrade/register registers the user (userId + userSecret stored
 * server-side) → /v1/snaptrade/connect-url returns the read-only connection
 * portal → the user links a brokerage → this endpoint lists the user's accounts,
 * reads positions via SnapTrade `/accounts/{id}/positions`, maps them to the
 * `holdings` table columns, and upserts via the Supabase SERVICE-ROLE client.
 *
 * SECURITY / COMPLIANCE (see docs/ASYMMETRY-RELEASE-ROADMAP.md "Compliance constraints"):
 *   * The SnapTrade `userSecret` is the sensitive credential. It is resolved +
 *     used SERVER-SIDE only (read from connected_accounts.snaptrade_user_secret,
 *     a service-role-only column) and is NEVER returned to the client.
 *   * Read-only: this only LISTS accounts and READS positions. No order
 *     placement, no trade/write scopes anywhere in the SnapTrade module.
 */

const HoldingsBody = z.object({
  // Supabase auth user id (uuid). Used as the SnapTrade user-store key and as
  // holdings.user_id / connected_accounts.user_id (RLS owner).
  userId: z.string().min(8),
});

// ── holdings table row contract (supabase/migrations/0001_init.sql) ───────────
interface HoldingRow {
  user_id: string;
  account_id: string | null; // uuid FK → connected_accounts.id
  ticker: string;
  quantity: number | null;
  cost_basis: number | null;
  market_value: number | null;
  currency: string;
}

// In-memory fallback when Supabase is not configured (dev only). The userSecret
// stays server-side in either case.
const memoryUsers = new Map<string, { snaptradeUserId: string; userSecret: string }>();

/**
 * Persist a registered SnapTrade user (userId + userSecret) SERVER-SIDE.
 * Writes the secret into the connected_accounts.snaptrade_user_secret column
 * (service-role only). Never reaches the client.
 */
export async function saveSnapTradeUser(
  appUserId: string,
  snaptradeUserId: string,
  userSecret: string
): Promise<void> {
  memoryUsers.set(appUserId, { snaptradeUserId, userSecret });
  if (!isSupabaseConfigured()) return;
  const sb = getServiceClient();
  const { error } = await sb.from("connected_accounts").upsert(
    {
      user_id: appUserId,
      provider: "snaptrade",
      snaptrade_user_id: snaptradeUserId,
      snaptrade_user_secret: userSecret, // SERVICE-ROLE column; never exposed
      status: "active",
      linked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,snaptrade_user_id" }
  );
  if (error) throw new Error(`Failed to persist SnapTrade user: ${error.message}`);
}

/**
 * Resolve a user's SnapTrade credentials, server-side only. Prefers the DB
 * (service-role read of the secret column); falls back to in-memory for dev.
 * Returns the connected_accounts row id for the holdings FK when available.
 */
export async function resolveSnapTradeUser(appUserId: string): Promise<
  | { snaptradeUserId: string; userSecret: string; connectedAccountId: string | null }
  | null
> {
  if (isSupabaseConfigured()) {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("connected_accounts")
      .select("id, snaptrade_user_id, snaptrade_user_secret")
      .eq("user_id", appUserId)
      .eq("provider", "snaptrade")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return {
        snaptradeUserId: data.snaptrade_user_id as string,
        userSecret: data.snaptrade_user_secret as string,
        connectedAccountId: data.id as string,
      };
    }
  }
  const mem = memoryUsers.get(appUserId);
  if (mem) return { ...mem, connectedAccountId: null };
  return null;
}

/** Best-effort ticker extraction from a SnapTrade Position. */
function positionTicker(p: SnapTradePosition): string {
  const sym = p.symbol?.symbol;
  return (
    (sym?.symbol && sym.symbol.trim()) ||
    (sym?.raw_symbol && sym.raw_symbol.trim()) ||
    (sym?.description && sym.description.trim()) ||
    "UNKN"
  );
}

/** Map SnapTrade positions → `holdings` table rows for a user/account. */
export function mapHoldings(
  positions: SnapTradePosition[],
  userId: string,
  connectedAccountId: string | null
): HoldingRow[] {
  return positions.map((p) => {
    const ticker = positionTicker(p);
    const quantity = p.units ?? null;
    const avgCost = p.average_purchase_price ?? null;
    const price = p.price ?? null;
    // SnapTrade gives per-share figures; derive position totals.
    const costBasis = avgCost != null && quantity != null ? avgCost * quantity : null;
    const marketValue = price != null && quantity != null ? price * quantity : null;
    const currency =
      p.symbol?.symbol?.currency?.code ?? p.currency?.code ?? "USD";
    return {
      user_id: userId,
      account_id: connectedAccountId,
      ticker,
      quantity,
      cost_basis: costBasis,
      market_value: marketValue,
      currency,
    };
  });
}

/**
 * POST /v1/snaptrade/holdings — fetch + persist read-only brokerage positions.
 * Refreshes on demand: lists the user's accounts, reads positions for each,
 * and replaces the user's holdings snapshot with the latest from SnapTrade.
 */
export async function postSnapTradeHoldings(req: Request, res: Response) {
  const parsed = HoldingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const { userId } = parsed.data;

  if (!isSnapTradeConfigured()) {
    res.status(503).json({ error: "SnapTrade not configured" });
    return;
  }

  const creds = await resolveSnapTradeUser(userId);
  if (!creds) {
    res
      .status(404)
      .json({ error: "User not registered with SnapTrade. Call /v1/snaptrade/register and connect a brokerage first." });
    return;
  }

  // Fetch accounts + positions (read-only). userSecret used server-side only.
  let rows: HoldingRow[];
  try {
    const accounts = await listAccounts(creds.snaptradeUserId, creds.userSecret);
    const all: SnapTradePosition[] = [];
    for (const acct of accounts) {
      const positions = await getAccountPositions(
        creds.snaptradeUserId,
        creds.userSecret,
        acct.id
      );
      all.push(...positions);
    }
    rows = mapHoldings(all, userId, creds.connectedAccountId);
  } catch (e) {
    if (e && typeof e === "object" && "status" in e) {
      const err = e as { status: number; detail: unknown };
      res.status(err.status >= 500 ? 502 : err.status).json({ error: "Positions fetch failed", detail: err.detail });
      return;
    }
    res.status(500).json({ error: String(e) });
    return;
  }

  // Persist when Supabase is configured. Refresh = replace this account's
  // snapshot, then insert the fresh rows (holdings is mutable, not append-only).
  let persisted = 0;
  if (isSupabaseConfigured()) {
    const sb = getServiceClient();
    try {
      let del = sb.from("holdings").delete().eq("user_id", userId);
      del = creds.connectedAccountId
        ? del.eq("account_id", creds.connectedAccountId)
        : del.is("account_id", null);
      const { error: delError } = await del;
      if (delError) {
        res.status(500).json({ error: "Holdings clear failed", detail: delError.message });
        return;
      }

      if (rows.length > 0) {
        const { error: insError, count } = await sb
          .from("holdings")
          .insert(rows, { count: "exact" });
        if (insError) {
          res.status(500).json({ error: "Holdings persist failed", detail: insError.message });
          return;
        }
        persisted = count ?? rows.length;
      }

      // Stamp last_synced_at on the connection (service-role).
      if (creds.connectedAccountId) {
        await sb
          .from("connected_accounts")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", creds.connectedAccountId);
      }
    } catch (e) {
      res.status(500).json({ error: String(e) });
      return;
    }
  }

  res.json({
    ok: true,
    userId,
    holdings_fetched: rows.length,
    holdings_persisted: persisted,
    persistence: isSupabaseConfigured() ? "supabase" : "skipped (Supabase not configured)",
    // NOTE: userSecret intentionally NOT included — it stays server-side.
  });
}
