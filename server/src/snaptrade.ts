import type { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";

/**
 * SnapTrade integration — READ-ONLY brokerage portfolio tracking.
 *
 * COMPLIANCE (non-negotiable — see docs/ASYMMETRY-RELEASE-ROADMAP.md
 * "Compliance constraints"): this module is READ-ONLY. It registers users,
 * generates a connection portal URL (the user connects their brokerage
 * read-only), lists accounts, and reads positions/holdings. It NEVER places,
 * cancels, or modifies orders and requests NO trade/write scopes. The
 * `snaptrade_user_secret` (the sensitive credential, analogous to Plaid's
 * access_token) is used SERVER-SIDE only and is NEVER returned to the client.
 *
 * Auth model (verified against SnapTrade API reference):
 *   - Base URL:  https://api.snaptrade.com/api/v1
 *   - `clientId` + `timestamp` (unix seconds) are sent as QUERY params.
 *   - `Signature` header = base64(HMAC-SHA256(consumerKey, canonicalJSON)) where
 *     canonicalJSON = JSON.stringify({ content, path, query }) with sorted keys,
 *     no whitespace, `content` = request body (null for GET / empty body),
 *     `path` = "/api/v1" + subpath, `query` = the query string (sans leading "?").
 *
 * No SDK: signed `fetch` (matches the no-SDK fetch style of the old plaid.ts).
 */

const SNAPTRADE_BASE = "https://api.snaptrade.com/api/v1";

export function isSnapTradeConfigured(): boolean {
  return !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

function clientId(): string {
  return process.env.SNAPTRADE_CLIENT_ID!;
}
function consumerKey(): string {
  return process.env.SNAPTRADE_CONSUMER_KEY!;
}

/**
 * Compute the SnapTrade request `Signature` header.
 * Mirrors the official SDK: canonical JSON of { content, path, query } signed
 * with HMAC-SHA256(consumerKey) and base64-encoded.
 *
 * @param subpath  endpoint path WITHOUT the /api/v1 prefix, e.g. "/snapTrade/registerUser"
 * @param query    query string WITHOUT the leading "?", e.g. "clientId=X&timestamp=1"
 * @param body     request body object, or null/undefined for GET / empty body
 */
function computeSignature(subpath: string, query: string, body: unknown): string {
  const content = body === undefined || body === null || isEmptyObject(body) ? null : body;
  const sigObject = { content, path: `/api/v1${subpath}`, query };
  const sigContent = stableStringify(sigObject);
  return crypto.createHmac("sha256", consumerKey()).update(sigContent).digest("base64");
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

/** Deterministic JSON.stringify with recursively sorted object keys, no whitespace. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/** Build the canonical query string with clientId + timestamp + extra params (sorted). */
function buildQuery(extra: Record<string, string> = {}): string {
  const params: Record<string, string> = {
    clientId: clientId(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extra,
  };
  // SnapTrade signs the literal query string; sort keys for determinism.
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

interface SnapTradeRequestOptions {
  method: "GET" | "POST";
  subpath: string;
  query?: Record<string, string>;
  body?: unknown;
}

/**
 * Signed fetch against the SnapTrade API. Returns parsed JSON.
 * Throws { status, detail } on non-2xx so callers can map to HTTP responses.
 */
async function snapTradeFetch<T = unknown>(opts: SnapTradeRequestOptions): Promise<T> {
  const query = buildQuery(opts.query);
  const signature = computeSignature(opts.subpath, query, opts.method === "POST" ? opts.body : null);
  const url = `${SNAPTRADE_BASE}${opts.subpath}?${query}`;

  const res = await fetch(url, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Signature: signature,
    },
    body: opts.method === "POST" && opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw { status: res.status, detail: parsed };
  }
  return parsed as T;
}

// ── Response shapes we consume (narrow) ───────────────────────────────────────
export interface SnapTradeRegisterResponse {
  userId: string;
  userSecret: string;
}

export interface SnapTradeAccount {
  id: string;
  brokerageAuthorization?: string; // BrokerageAuthorization (connection) id
  name?: string | null;
  number?: string | null;
  institution_name?: string | null;
  status?: string | null;
}

export interface PositionSymbolDetail {
  symbol?: string | null;
  raw_symbol?: string | null;
  description?: string | null;
  currency?: { code?: string | null } | null;
}

export interface SnapTradePosition {
  symbol?: {
    // Position.symbol is a PositionSymbol wrapper around the universal symbol.
    symbol?: PositionSymbolDetail | null;
    id?: string | null;
  } | null;
  units?: number | null;
  price?: number | null;
  average_purchase_price?: number | null;
  open_pnl?: number | null;
  currency?: { code?: string | null } | null;
}

// ── SnapTrade API calls (READ-ONLY) ───────────────────────────────────────────

/** POST /snapTrade/registerUser — create a SnapTrade user, returns { userId, userSecret }. */
export async function registerSnapTradeUser(userId: string): Promise<SnapTradeRegisterResponse> {
  return snapTradeFetch<SnapTradeRegisterResponse>({
    method: "POST",
    subpath: "/snapTrade/registerUser",
    body: { userId },
  });
}

/**
 * POST /snapTrade/login — generate the connection portal (login) URL. The user
 * opens this to connect their brokerage READ-ONLY. Returns { redirectURI }.
 */
export async function loginSnapTradeUser(
  userId: string,
  userSecret: string
): Promise<{ redirectURI?: string }> {
  return snapTradeFetch<{ redirectURI?: string }>({
    method: "POST",
    subpath: "/snapTrade/login",
    query: { userId, userSecret },
    // Read-only portal: no trade scopes requested.
    body: {},
  });
}

/** GET /accounts — list the user's brokerage accounts across all connections. */
export async function listAccounts(
  userId: string,
  userSecret: string
): Promise<SnapTradeAccount[]> {
  return snapTradeFetch<SnapTradeAccount[]>({
    method: "GET",
    subpath: "/accounts",
    query: { userId, userSecret },
  });
}

/** GET /accounts/{accountId}/positions — read positions for one account (read-only). */
export async function getAccountPositions(
  userId: string,
  userSecret: string,
  accountId: string
): Promise<SnapTradePosition[]> {
  return snapTradeFetch<SnapTradePosition[]>({
    method: "GET",
    subpath: `/accounts/${encodeURIComponent(accountId)}/positions`,
    query: { userId, userSecret },
  });
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

const RegisterBody = z.object({ userId: z.string().min(8) });

/**
 * POST /v1/snaptrade/register — register the user with SnapTrade and persist the
 * userSecret SERVER-SIDE (service-role column). The secret is NEVER returned.
 */
export async function postSnapTradeRegister(req: Request, res: Response) {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  if (!isSnapTradeConfigured()) {
    res.status(503).json({
      error: "SnapTrade not configured",
      message: "Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY on the server.",
    });
    return;
  }

  try {
    const { saveSnapTradeUser } = await import("./holdings.js");
    const reg = await registerSnapTradeUser(parsed.data.userId);
    // Persist userId + userSecret server-side (service-role only).
    await saveSnapTradeUser(parsed.data.userId, reg.userId, reg.userSecret);
    // NOTE: userSecret intentionally NOT returned — it stays server-side.
    res.json({ ok: true, userId: parsed.data.userId, registered: true });
  } catch (e) {
    handleError(res, e, "SnapTrade register failed");
  }
}

/**
 * POST /v1/snaptrade/connect-url — generate the read-only connection portal URL
 * for the user to link their brokerage.
 */
export async function postSnapTradeConnectUrl(req: Request, res: Response) {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  if (!isSnapTradeConfigured()) {
    res.status(503).json({ error: "SnapTrade not configured" });
    return;
  }

  try {
    const { resolveSnapTradeUser } = await import("./holdings.js");
    const creds = await resolveSnapTradeUser(parsed.data.userId);
    if (!creds) {
      res.status(404).json({ error: "User not registered with SnapTrade. Call /v1/snaptrade/register first." });
      return;
    }
    const login = await loginSnapTradeUser(creds.snaptradeUserId, creds.userSecret);
    res.json({ ok: true, redirectURI: login.redirectURI });
  } catch (e) {
    handleError(res, e, "SnapTrade connect-url failed");
  }
}

function handleError(res: Response, e: unknown, label: string) {
  if (e && typeof e === "object" && "status" in e) {
    const err = e as { status: number; detail: unknown };
    res.status(err.status >= 500 ? 502 : err.status).json({ error: label, detail: err.detail });
    return;
  }
  res.status(500).json({ error: String(e) });
}
