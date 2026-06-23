import type { Request, Response } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";

const UserBody = z.object({ userId: z.string().min(8) });

// ── JSON file persistence ──────────────────────────────────────────────
const DATA_DIR = path.resolve("data");
const TOKENS_PATH = path.join(DATA_DIR, "plaid-tokens.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadTokens(): Record<string, { access_token: string; item_id: string }> {
  try {
    if (fs.existsSync(TOKENS_PATH)) return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
  } catch { /* corrupt file, start fresh */ }
  return {};
}

function saveTokens(tokens: Record<string, { access_token: string; item_id: string }>) {
  ensureDataDir();
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function getPlaidBase(): string {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (env === "production") return "https://production.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://sandbox.plaid.com";
}

export function plaidHeaders() {
  return { "Content-Type": "application/json" };
}

export function plaidCredentials() {
  return {
    client_id: process.env.PLAID_CLIENT_ID!,
    secret: process.env.PLAID_SECRET!,
  };
}

export function isPlaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// ── Link token ─────────────────────────────────────────────────────────
/**
 * Plaid Link token, requires PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV in server .env
 * @see https://plaid.com/docs/link/
 */
export async function postPlaidLinkToken(req: Request, res: Response) {
  const parsed = UserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  if (!isPlaidConfigured()) {
    res.status(503).json({
      error: "Plaid not configured",
      message: "Set PLAID_CLIENT_ID and PLAID_SECRET on server. Use connectDemoAccounts in app for now.",
    });
    return;
  }

  const base = getPlaidBase();

  try {
    const r = await fetch(`${base}/link/token/create`, {
      method: "POST",
      headers: plaidHeaders(),
      body: JSON.stringify({
        ...plaidCredentials(),
        user: { client_user_id: parsed.data.userId },
        client_name: "Thesis",
        // COMPLIANCE (read-only, non-negotiable — see docs/ASYMMETRY-RELEASE-ROADMAP.md
        // "Compliance constraints" #1): request the `investments` product ONLY.
        // No `auth` / `transactions` / `liabilities` / `transfer` / `payment_initiation`
        // scopes — the product never reads bank routing numbers nor places/moves money.
        // This is the read-only Investments holdings ingest (M2): /investments/holdings/get.
        products: ["investments"],
        country_codes: ["US"],
        language: "en",
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: "Plaid link token failed", detail: data });
      return;
    }
    res.json({
      link_token: data.link_token,
      expiration: data.expiration,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

// ── Exchange public_token → access_token ──────────────────────────────
export async function postPlaidExchange(req: Request, res: Response) {
  const parsed = z
    .object({ userId: z.string(), public_token: z.string() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  if (!isPlaidConfigured()) {
    res.status(503).json({ error: "Plaid not configured" });
    return;
  }

  const base = getPlaidBase();

  try {
    const r = await fetch(`${base}/item/public_token/exchange`, {
      method: "POST",
      headers: plaidHeaders(),
      body: JSON.stringify({
        ...plaidCredentials(),
        public_token: parsed.data.public_token,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: "Exchange failed", detail: data });
      return;
    }

    // Persist access_token + item_id per userId
    const tokens = loadTokens();
    tokens[parsed.data.userId] = {
      access_token: data.access_token,
      item_id: data.item_id,
    };
    saveTokens(tokens);

    res.json({
      item_id: data.item_id,
      accounts_synced: 0,
      message: "Token persisted. Call /v1/plaid/sync to fetch accounts.",
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

// ── Sync: fetch accounts + holdings from Plaid ────────────────────────
export async function postPlaidSync(req: Request, res: Response) {
  const parsed = UserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  if (!isPlaidConfigured()) {
    res.status(503).json({ error: "Plaid not configured" });
    return;
  }

  const tokens = loadTokens();
  const entry = tokens[parsed.data.userId];
  if (!entry) {
    res.status(404).json({ error: "No linked Plaid item for this user. Connect first." });
    return;
  }

  const base = getPlaidBase();
  const creds = plaidCredentials();

  try {
    // Fetch accounts
    const accountsRes = await fetch(`${base}/accounts/get`, {
      method: "POST",
      headers: plaidHeaders(),
      body: JSON.stringify({ ...creds, access_token: entry.access_token }),
    });
    const accountsData = await accountsRes.json();
    if (!accountsRes.ok) {
      res.status(502).json({ error: "Accounts fetch failed", detail: accountsData });
      return;
    }

    // Fetch investment holdings
    let holdings: any[] = [];
    try {
      const holdingsRes = await fetch(`${base}/investments/holdings/get`, {
        method: "POST",
        headers: plaidHeaders(),
        body: JSON.stringify({ ...creds, access_token: entry.access_token }),
      });
      const holdingsData = await holdingsRes.json();
      if (holdingsRes.ok) {
        holdings = holdingsData.holdings ?? [];
        // Attach security names
        const securitiesMap = new Map<string, string>();
        for (const sec of holdingsData.securities ?? []) {
          securitiesMap.set(sec.security_id, sec.name ?? sec.ticker_symbol ?? sec.security_id);
        }
        for (const h of holdings) {
          h._security_name = securitiesMap.get(h.security_id) ?? h.security_id;
        }
      }
    } catch {
      // holdings optional — some items don't have investments
    }

    // Map to Thesis LinkedAccount format
    const now = Date.now();
    const mappedAccounts = (accountsData.accounts ?? []).map((a: any) => ({
      id: a.account_id,
      plaidAccountId: a.account_id,
      name: a.name,
      mask: a.mask ?? "0000",
      institution: a.official_name ?? "Linked Institution",
      type: (a.type as string) ?? "other",
      subtype: a.subtype ?? a.type ?? "",
      balance: a.balances?.current ?? a.balances?.available ?? 0,
      changePct1m: undefined,
      lastSyncedAt: now,
    }));

    // Map Plaid holdings to simple format (different from store's Holding type)
    const mappedHoldings = holdings.map((h: any) => ({
      symbol: (h.security_id ?? "").slice(0, 5).toUpperCase() || h._security_name?.slice(0, 5) || "UNKN",
      name: h._security_name ?? h.security_id ?? "Unknown",
      quantity: h.quantity ?? 0,
      costBasis: h.cost_basis ?? null,
      accountId: h.account_id,
    }));

    res.json({
      ok: true,
      userId: parsed.data.userId,
      accounts: mappedAccounts,
      holdings: mappedHoldings,
      item_id: entry.item_id,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

// ── Webhook ────────────────────────────────────────────────────────────
export function postPlaidWebhook(_req: Request, res: Response) {
  // TODO: handle TRANSACTIONS / HOLDINGS / ITEM webhooks for real-time updates
  res.json({ ok: true });
}
