// Version: 1
// Function: earnings-monitor | Project: jmtkygwvmrolfvwueggs
// Schedule: daily at 08:00 UTC via pg_cron
//
// Scans every ticker in radar_watchlist for three signals:
//   1. Earnings within 48 hours — deduped via earnings_alerts table
//   2. Insider cluster buy — 3+ open-market purchases in last 30 days
//   3. Material news — headlines matching high-signal keywords
//
// Handler:
//   POST {}                          → full scan, all watchlist tickers
//   POST {"test":true,"ticker":"ASTS"} → single ticker, no dedup check

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const NTFY_TOPIC = "asymmetry-radar";
const YF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MATERIAL_KEYWORDS = [
  "contract",
  "award",
  "awarded",
  "fda",
  "acquisition",
  "acquires",
  "partnership",
  "wins",
  "launch",
  "approved",
  "approval",
  "breakthrough",
  "patent",
];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Yahoo Finance auth ────────────────────────────────────────────────────────

interface YFAuth {
  cookie: string;
  crumb: string;
}

async function getYFAuth(): Promise<YFAuth | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      redirect: "follow",
      headers: { "User-Agent": YF_UA, "Accept": "text/html,*/*" },
    });
    const cookie = (r1.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return null;
    const r2 = await fetch(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { "User-Agent": YF_UA, "Cookie": cookie } },
    );
    if (!r2.ok) return null;
    const crumb = await r2.text();
    if (!crumb || crumb.includes("<")) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

// ── quoteSummary fetch ────────────────────────────────────────────────────────

interface QuoteSummaryResult {
  calendarEvents?: {
    earnings?: {
      earningsDate?: Array<{ raw: number; fmt: string }>;
    };
  };
  insiderTransactions?: {
    transactions?: Array<{
      filerName?: string;
      transactionText?: string;
      startDate?: { raw: number; fmt: string };
      shares?: { raw: number };
      value?: { raw: number };
    }>;
  };
  price?: {
    shortName?: string;
  };
}

async function getQuoteSummary(
  ticker: string,
  auth: YFAuth,
): Promise<QuoteSummaryResult | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=calendarEvents,insiderTransactions,price&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": YF_UA,
        "Accept": "application/json, */*",
        "Referer": "https://finance.yahoo.com/",
        "Cookie": auth.cookie,
      },
    });
    if (!res.ok) {
      console.error(`[yf] quoteSummary ${ticker} → ${res.status}`);
      return null;
    }
    const j = await res.json();
    return j?.quoteSummary?.result?.[0] ?? null;
  } catch (e) {
    console.error(`[yf] quoteSummary ${ticker} error: ${String(e)}`);
    return null;
  }
}

// ── Yahoo Finance news fetch ──────────────────────────────────────────────────

interface YFNewsItem {
  title: string;
  providerPublishTime: number;
  link?: string;
}

async function getNewsHeadlines(
  ticker: string,
  auth: YFAuth,
): Promise<YFNewsItem[]> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": YF_UA,
        "Accept": "application/json, */*",
        "Referer": "https://finance.yahoo.com/",
        "Cookie": auth.cookie,
      },
    });
    if (!res.ok) return [];
    const j = await res.json();
    return (j?.news ?? []) as YFNewsItem[];
  } catch {
    return [];
  }
}

// ── GitHub vault push ─────────────────────────────────────────────────────────

async function pushToGitHub(
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) return;
  const repo = Deno.env.get("GITHUB_REPO") ?? "maple-maker/aegis-intel-vault";
  const branch = Deno.env.get("GITHUB_BRANCH") ?? "main";
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const hdrs = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "asymmetry-radar",
    "Content-Type": "application/json",
  };
  let sha: string | undefined;
  try {
    const r = await fetch(`${apiUrl}?ref=${branch}`, { headers: hdrs });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* new file */ }
  const payload: Record<string, unknown> = {
    message,
    branch,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) payload.sha = sha;
  try {
    const res = await fetch(apiUrl, {
      method: "PUT",
      headers: hdrs,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(
        `[github] PUT ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
  } catch (e) {
    console.error(`[github] push error: ${String(e)}`);
  }
}

// ── Notification ──────────────────────────────────────────────────────────────

async function notify(
  title: string,
  body: string,
  priority = 4,
): Promise<void> {
  try {
    await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title,
        message: body,
        priority,
        tags: ["bell"],
      }),
    });
  } catch (e) {
    console.error(`[ntfy] error: ${String(e)}`);
  }
}

// ── Signal 1: Earnings alert ──────────────────────────────────────────────────

function formatEarningsAlert(
  ticker: string,
  earningsDate: Date,
  hoursUntil: number,
): string {
  const dateStr = earningsDate.toISOString().slice(0, 10);
  return [
    `📅 EARNINGS ALERT — $${ticker}`,
    "━".repeat(30),
    `Earnings in ~${Math.round(hoursUntil)} hours`,
    `Date: ${dateStr}`,
    "",
    "⚡ WATCH: This is a catalyst event.",
    "Check thesis + invalidation trigger before earnings.",
    "Position: review and size appropriately.",
  ].join("\n");
}

async function checkEarnings(
  ticker: string,
  qsr: QuoteSummaryResult,
  testMode: boolean,
): Promise<{ alerted: boolean; earningsDate: string | null }> {
  const earningsDates =
    qsr.calendarEvents?.earnings?.earningsDate ?? [];
  if (earningsDates.length === 0) {
    return { alerted: false, earningsDate: null };
  }

  const now = Date.now();

  for (const ed of earningsDates) {
    const tsMs = ed.raw * 1000;
    if (tsMs < now) continue; // past date — skip

    const hoursUntil = (tsMs - now) / (1000 * 60 * 60);
    if (hoursUntil > 48) continue; // not within window — skip

    const earningsDateStr = new Date(tsMs).toISOString().slice(0, 10);

    // Deduplication: skip if already alerted (unless test mode)
    if (!testMode) {
      const { data: existing } = await supabase
        .from("earnings_alerts")
        .select("id")
        .eq("ticker", ticker)
        .eq("earnings_date", earningsDateStr)
        .maybeSingle();
      if (existing) {
        console.log(`[earnings] ${ticker} ${earningsDateStr} already alerted`);
        return { alerted: false, earningsDate: earningsDateStr };
      }
    }

    // Send alert
    const msg = formatEarningsAlert(
      ticker,
      new Date(tsMs),
      hoursUntil,
    );
    await notify(`📅 EARNINGS — $${ticker} in ~${Math.round(hoursUntil)}h`, msg, 5);

    // Record dedup row (skip in test mode to avoid polluting the table)
    if (!testMode) {
      await supabase.from("earnings_alerts").insert({
        ticker,
        earnings_date: earningsDateStr,
        alerted_at: new Date().toISOString(),
      });
    }

    return { alerted: true, earningsDate: earningsDateStr };
  }

  return { alerted: false, earningsDate: null };
}

// ── Signal 2: Insider cluster buy ────────────────────────────────────────────

function formatInsiderAlert(
  ticker: string,
  count: number,
  buyers: string[],
): string {
  const dedupedBuyers = [...new Set(buyers)];
  return [
    `🔥 INSIDER CLUSTER BUY — $${ticker}`,
    "━".repeat(30),
    `${count} open-market purchases in last 30 days`,
    "Signal: Insiders buying at current prices",
    "",
    `Names: ${dedupedBuyers.join(", ")}`,
    "This is one of the highest-conviction signals.",
  ].join("\n");
}

async function checkInsiderCluster(
  ticker: string,
  qsr: QuoteSummaryResult,
): Promise<{ alerted: boolean; count: number }> {
  const transactions = qsr.insiderTransactions?.transactions ?? [];
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const recentPurchases = transactions.filter((t) => {
    const txMs = (t.startDate?.raw ?? 0) * 1000;
    if (txMs < thirtyDaysAgo) return false;
    const text = (t.transactionText ?? "").toLowerCase();
    // Only open-market purchases — exclude option exercises, sales, grants
    return text.includes("purchase") && !text.includes("option");
  });

  if (recentPurchases.length < 3) {
    return { alerted: false, count: recentPurchases.length };
  }

  const buyers = recentPurchases.map((t) => t.filerName ?? "Unknown");
  const msg = formatInsiderAlert(ticker, recentPurchases.length, buyers);
  await notify(
    `🔥 INSIDER CLUSTER BUY — $${ticker} (${recentPurchases.length} purchases)`,
    msg,
    4,
  );

  return { alerted: true, count: recentPurchases.length };
}

// ── Signal 3: Material news scanner ──────────────────────────────────────────

function formatNewsAlert(
  ticker: string,
  keyword: string,
  headline: string,
): string {
  return [
    `📰 MATERIAL NEWS — $${ticker}`,
    "━".repeat(30),
    `Keyword: ${keyword}`,
    `Headline: ${headline}`,
    "",
    "May warrant a fresh scan. Check thesis.",
  ].join("\n");
}

async function checkMaterialNews(
  ticker: string,
  auth: YFAuth,
): Promise<{ alerted: boolean; headline: string | null; keyword: string | null }> {
  const news = await getNewsHeadlines(ticker, auth);
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000; // last 24 hours

  for (const item of news) {
    // Only recent news
    if ((item.providerPublishTime ?? 0) * 1000 < cutoffMs) continue;

    const titleLower = (item.title ?? "").toLowerCase();
    for (const kw of MATERIAL_KEYWORDS) {
      if (titleLower.includes(kw)) {
        await notify(
          `📰 MATERIAL NEWS — $${ticker} [${kw}]`,
          formatNewsAlert(ticker, kw, item.title),
          3,
        );
        return { alerted: true, headline: item.title, keyword: kw };
      }
    }
  }

  return { alerted: false, headline: null, keyword: null };
}

// ── Obsidian earnings calendar (14-day) ───────────────────────────────────────

interface EarningsEntry {
  ticker: string;
  notes: string;
  earningsDate: string; // YYYY-MM-DD
  daysUntil: number;
}

function generateEarningsMarkdown(
  entries: EarningsEntry[],
  scanDate: string,
): string {
  const sorted = [...entries].sort((a, b) =>
    a.earningsDate.localeCompare(b.earningsDate)
  );

  const rows = sorted.length > 0
    ? sorted
      .map(
        (e) =>
          `| $${e.ticker} | ${e.earningsDate} | ${e.daysUntil}d | ${e.notes || "—"} |`,
      )
      .join("\n")
    : "| — | — | — | No earnings in next 14 days |";

  return `---
date: ${scanDate}
type: earnings-calendar
tags: [earnings-monitor, catalyst-calendar]
---

# Earnings Calendar — Next 14 Days
*Generated by earnings-monitor · ${scanDate}*

| Ticker | Earnings Date | Days Until | Notes |
|--------|--------------|-----------|-------|
${rows}

---
*Asymmetry Radar · ${scanDate} · Not investment advice.*
`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const testMode = body.test === true;
  const testTicker: string | null = body.ticker ?? null;

  const scanDate = new Date().toISOString().slice(0, 10);
  const results: Array<{
    ticker: string;
    earnings_alerted: boolean;
    insider_alerted: boolean;
    news_alerted: boolean;
    error?: string;
  }> = [];

  // Obtain YF auth once — shared across all tickers
  const auth = await getYFAuth();
  if (!auth) {
    return new Response(
      JSON.stringify({ ok: false, error: "Yahoo Finance auth failed" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve ticker list
  let tickers: Array<{ ticker: string; notes: string }>;
  if (testMode && testTicker) {
    tickers = [{ ticker: testTicker, notes: "test run" }];
  } else {
    const { data: wl, error: wlErr } = await supabase
      .from("radar_watchlist")
      .select("ticker, notes");
    if (wlErr) {
      return new Response(
        JSON.stringify({ ok: false, error: `watchlist fetch: ${wlErr.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    tickers = (wl ?? []) as Array<{ ticker: string; notes: string }>;
  }

  // Per-ticker scan
  const earningsCalendar: EarningsEntry[] = [];
  const now = Date.now();
  const fourteenDays = 14 * 24 * 60 * 60 * 1000;

  for (const { ticker, notes } of tickers) {
    const tickerResult = {
      ticker,
      earnings_alerted: false,
      insider_alerted: false,
      news_alerted: false,
    };

    try {
      // Fetch quoteSummary (calendarEvents + insiderTransactions + price)
      const qsr = await getQuoteSummary(ticker, auth);
      if (!qsr) {
        results.push({ ...tickerResult, error: "quoteSummary returned null" });
        continue;
      }

      // ── Signal 1: Earnings alert ──────────────────────────────────────────
      const earningsResult = await checkEarnings(ticker, qsr, testMode);
      tickerResult.earnings_alerted = earningsResult.alerted;

      // Collect all upcoming earnings within 14 days for the vault calendar
      const earningsDates =
        qsr.calendarEvents?.earnings?.earningsDate ?? [];
      for (const ed of earningsDates) {
        const tsMs = ed.raw * 1000;
        if (tsMs < now) continue;
        const msUntil = tsMs - now;
        if (msUntil > fourteenDays) continue;
        const daysUntil = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
        const earningsDate = new Date(tsMs).toISOString().slice(0, 10);
        earningsCalendar.push({ ticker, notes: notes ?? "", earningsDate, daysUntil });
      }

      // ── Signal 2: Insider cluster buy ─────────────────────────────────────
      const insiderResult = await checkInsiderCluster(ticker, qsr);
      tickerResult.insider_alerted = insiderResult.alerted;

      // ── Signal 3: Material news ───────────────────────────────────────────
      const newsResult = await checkMaterialNews(ticker, auth);
      tickerResult.news_alerted = newsResult.alerted;

      results.push(tickerResult);
    } catch (e) {
      console.error(`[monitor] ${ticker} failed: ${String(e)}`);
      results.push({ ...tickerResult, error: String(e) });
    }

    // Brief pause between tickers to avoid rate limiting
    await new Promise((r) => setTimeout(r, 800));
  }

  // ── Push earnings calendar to GitHub vault ────────────────────────────────
  if (!testMode || earningsCalendar.length > 0) {
    const mdContent = generateEarningsMarkdown(earningsCalendar, scanDate);
    await pushToGitHub(
      `vault/earnings/${scanDate}.md`,
      mdContent,
      `earnings: calendar update [${scanDate}]`,
    );
  }

  const earningsCount = results.filter((r) => r.earnings_alerted).length;
  const insiderCount = results.filter((r) => r.insider_alerted).length;
  const newsCount = results.filter((r) => r.news_alerted).length;
  const errorCount = results.filter((r) => r.error).length;

  console.log(
    `[monitor] ${scanDate} — scanned ${results.length} tickers | ` +
      `earnings=${earningsCount} insider=${insiderCount} news=${newsCount} errors=${errorCount}`,
  );

  return new Response(
    JSON.stringify(
      {
        ok: true,
        date: scanDate,
        tickers_scanned: results.length,
        earnings_alerts: earningsCount,
        insider_alerts: insiderCount,
        news_alerts: newsCount,
        errors: errorCount,
        results,
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/json" } },
  );
});
