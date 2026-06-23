import type { Request, Response } from "express";
import { z } from "zod";

import {
  getPlaidBase,
  isPlaidConfigured,
  loadTokens,
  plaidCredentials,
  plaidHeaders,
} from "./plaid.js";
import { getServiceClient, isSupabaseConfigured } from "./supabase.js";

/**
 * M2 — Plaid Investments holdings ingest (READ-ONLY).
 *
 * Flow: existing Plaid Link → /v1/plaid/exchange persists the access_token
 * server-side → this endpoint calls Plaid `/investments/holdings/get` for the
 * linked item, maps the response to the `holdings` table columns, and upserts
 * via the Supabase SERVICE-ROLE client.
 *
 * SECURITY / COMPLIANCE (see docs/ASYMMETRY-RELEASE-ROADMAP.md "Compliance constraints"):
 *   * The Plaid `access_token` is resolved + used SERVER-SIDE only. It is read
 *     from the existing exchange token store / `connected_accounts` (service-role
 *     column) and is NEVER returned to the client in any response.
 *   * Read-only: this only calls `/investments/holdings/get`. The Link flow
 *     (postPlaidLinkToken) requests the `investments` product ONLY — no
 *     transfer/payment/auth write scope.
 */

const HoldingsBody = z.object({
  // Supabase auth user id (uuid). Used both as the Plaid token-store key and as
  // holdings.user_id / connected_accounts.user_id (RLS owner).
  userId: z.string().min(8),
});

// ── Plaid response shapes we consume (narrow — Plaid sends much more) ─────────
interface PlaidSecurity {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity?: number | null;
  cost_basis?: number | null;
  institution_value?: number | null; // market value of the position
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
}

interface PlaidHoldingsResponse {
  holdings?: PlaidHolding[];
  securities?: PlaidSecurity[];
  item?: { item_id?: string };
}

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

/**
 * Resolve a Plaid access_token + item_id for a user, server-side only.
 * Reuses the existing exchange token store (plaid.ts). When Supabase is
 * configured it also reflects the link into `connected_accounts` (service-role)
 * so the canonical token home is the DB, returning that row's uuid for the FK.
 */
async function resolveLink(
  userId: string
): Promise<{ accessToken: string; itemId: string; connectedAccountId: string | null } | null> {
  const tokens = loadTokens();
  const entry = tokens[userId];
  if (!entry) return null;

  let connectedAccountId: string | null = null;
  if (isSupabaseConfigured()) {
    const sb = getServiceClient();
    // Service-role write of the token into connected_accounts (column is
    // service-role only; never reaches the client).
    const { data, error } = await sb
      .from("connected_accounts")
      .upsert(
        {
          user_id: userId,
          provider: "plaid",
          plaid_item_id: entry.item_id,
          plaid_access_token: entry.access_token,
          status: "active",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id,plaid_item_id" }
      )
      .select("id")
      .single();
    if (!error && data) connectedAccountId = data.id as string;
  }

  return { accessToken: entry.access_token, itemId: entry.item_id, connectedAccountId };
}

/** Map a Plaid holdings response → `holdings` table rows for a user. */
export function mapHoldings(
  data: PlaidHoldingsResponse,
  userId: string,
  connectedAccountId: string | null
): HoldingRow[] {
  const securities = new Map<string, PlaidSecurity>();
  for (const sec of data.securities ?? []) securities.set(sec.security_id, sec);

  return (data.holdings ?? []).map((h) => {
    const sec = securities.get(h.security_id);
    const ticker =
      (sec?.ticker_symbol && sec.ticker_symbol.trim()) ||
      (sec?.name && sec.name.trim()) ||
      h.security_id;
    const currency =
      h.iso_currency_code ??
      h.unofficial_currency_code ??
      sec?.iso_currency_code ??
      sec?.unofficial_currency_code ??
      "USD";
    return {
      user_id: userId,
      account_id: connectedAccountId,
      ticker,
      quantity: h.quantity ?? null,
      cost_basis: h.cost_basis ?? null,
      market_value: h.institution_value ?? null,
      currency,
    };
  });
}

/**
 * POST /v1/plaid/holdings — fetch + persist read-only Investments holdings.
 * Refreshes on demand: replaces the user's holdings snapshot for the linked
 * account with the latest from Plaid.
 */
export async function postPlaidHoldings(req: Request, res: Response) {
  const parsed = HoldingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const { userId } = parsed.data;

  if (!isPlaidConfigured()) {
    res.status(503).json({ error: "Plaid not configured" });
    return;
  }

  const link = await resolveLink(userId);
  if (!link) {
    res.status(404).json({ error: "No linked Plaid item for this user. Connect first." });
    return;
  }

  const base = getPlaidBase();
  const creds = plaidCredentials();

  let data: PlaidHoldingsResponse;
  try {
    const r = await fetch(`${base}/investments/holdings/get`, {
      method: "POST",
      headers: plaidHeaders(),
      // access_token used server-side only — never echoed back to the client.
      body: JSON.stringify({ ...creds, access_token: link.accessToken }),
    });
    data = (await r.json()) as PlaidHoldingsResponse;
    if (!r.ok) {
      res.status(502).json({ error: "Holdings fetch failed", detail: data });
      return;
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
    return;
  }

  const rows = mapHoldings(data, userId, link.connectedAccountId);

  // Persist when Supabase is configured. Refresh = replace this account's
  // snapshot, then insert the fresh rows (holdings is mutable, not append-only).
  let persisted = 0;
  if (isSupabaseConfigured()) {
    const sb = getServiceClient();
    try {
      let del = sb.from("holdings").delete().eq("user_id", userId);
      del = link.connectedAccountId
        ? del.eq("account_id", link.connectedAccountId)
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
    } catch (e) {
      res.status(500).json({ error: String(e) });
      return;
    }
  }

  res.json({
    ok: true,
    userId,
    item_id: link.itemId,
    holdings_fetched: rows.length,
    holdings_persisted: persisted,
    persistence: isSupabaseConfigured() ? "supabase" : "skipped (Supabase not configured)",
    // NOTE: access_token intentionally NOT included — it stays server-side.
  });
}
