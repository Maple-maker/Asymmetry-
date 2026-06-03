// Function: publish-to-feed
// Purpose: bridge conviction_debates results → opportunity_feed (the app's read model).
//          Called automatically by conviction-debate after a successful debate,
//          OR manually: POST {"debate_id": "uuid"} to re-publish a specific debate.
//
// Also handles probability scoring and buy zone calculation.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const FMP_KEY = Deno.env.get("FMP_API_KEY");

// ── Probability model ─────────────────────────────────────────────────────────
// Weights: catalyst specificity (35%), conviction score (25%), management (20%), asymmetry (20%)
function calcProbability(scores: {
  asymmetry: number; conviction: number; catalyst: number; management: number;
}): number {
  const base = (
    scores.catalyst  * 0.35 +
    scores.conviction * 0.25 +
    scores.management * 0.20 +
    scores.asymmetry  * 0.20
  );
  // Scale to 0-95 (never claim 100% certainty)
  return Math.min(95, Math.round(base * 9.5));
}

// ── Buy zone calculator ───────────────────────────────────────────────────────
// Aggressive: current price (or slight pullback if extended)
// Base: 5-10% below current (standard thesis entry)
// Conservative: near the floor price (confirmed breakout entry)
function calcBuyZones(price: number, floorPrice: number | null, targetPrice: number | null): {
  aggressive: number; base: number; conservative: number;
} {
  const floor = floorPrice ?? price * 0.6;
  const target = targetPrice ?? price * 2;
  const range = target - floor;

  return {
    aggressive:   Math.round(price * 0.98 * 100) / 100,        // current − 2%
    base:         Math.round(price * 0.90 * 100) / 100,        // current − 10%
    conservative: Math.round((floor + range * 0.15) * 100) / 100, // 15% above floor
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  try {
    let debates: Record<string, unknown>[];

    if (body.debate_id) {
      const { data, error } = await supabase
        .from("conviction_debates")
        .select("*")
        .eq("id", body.debate_id)
        .limit(1);
      if (error) throw error;
      debates = data ?? [];
    } else {
      // Default: process debates from the last 2 hours not yet in the feed
      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("opportunity_feed")
        .select("conviction_debate_id");
      const existingIds = new Set((existing ?? []).map((r: Record<string, unknown>) => r.conviction_debate_id));

      const { data, error } = await supabase
        .from("conviction_debates")
        .select("*")
        .gte("debated_at", cutoff)
        .order("debated_at", { ascending: false });
      if (error) throw error;

      debates = (data ?? []).filter((d: Record<string, unknown>) => !existingIds.has(d.id));
    }

    if (debates.length === 0) {
      return Response.json({ status: "nothing_new", message: "No new debates to publish." });
    }

    const published = [];

    for (const debate of debates) {
      try {
        const ticker = debate.ticker as string;
        const allCandidates = (debate.all_candidates as Array<{ ticker: string; score: number }>) ?? [];
        const scores = {
          asymmetry:  (debate.asymmetry_score as number) ?? 7,
          conviction: (debate.conviction_score as number) ?? 7,
          catalyst:   (debate.catalyst_score as number) ?? 7,
          management: (debate.management_score as number) ?? 7,
        };
        const overallScore = (debate.overall_score as number) ?? 75;
        const tier = (debate.tier as number) ?? 2;

        // Fetch live price from FMP
        let snap = null;
        if (FMP_KEY) {
          try {
            const [profRes, metRes] = await Promise.all([
              fetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(10000) }),
              fetch(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${ticker}?apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(10000) }),
            ]);
            const p = profRes.ok ? (await profRes.json())[0] : null;
            const m = metRes.ok ? (await metRes.json())[0] : null;
            if (p) snap = {
              price: p.price, mktCap: p.mktCap, pe: p.pe ?? m?.peRatioTTM,
              evToEbitda: m?.evToEbitdaTTM, psRatioTTM: m?.priceToSalesRatioTTM,
              pfcfRatioTTM: m?.priceToFreeCashFlowsRatioTTM,
              grossMarginTTM: m?.grossProfitMarginTTM, revenueGrowthTTM: m?.revenueGrowthTTM,
              beta: p.beta, sector: p.sector, industry: p.industry,
            };
          } catch (e) { console.warn(`[fmp] ${e}`); }
        }

        const price = snap?.price ?? 0;
        const targetPrice = (debate.target_price as number | null) ?? null;
        const floorPrice = (debate.floor_price as number | null) ?? null;
        const zones = price > 0 ? calcBuyZones(price, floorPrice, targetPrice) : null;
        const probability = calcProbability(scores);

        const upsidePct = targetPrice && price ? ((targetPrice - price) / price * 100) : null;
        const downsidePct = floorPrice && price ? ((price - floorPrice) / price * 100) : null;

        const feedRow = {
          conviction_debate_id: debate.id as string,
          ticker,
          company_name:         debate.company_name as string,
          tier,
          overall_score:        overallScore,
          bluf:                 (debate.market_miss as string) || "See full report",
          thesis:               "",
          bull_case:            null,
          bear_case:            null,
          buy_zone_aggressive:  zones?.aggressive ?? null,
          buy_zone_base:        zones?.base ?? null,
          buy_zone_conservative: zones?.conservative ?? null,
          catalyst:             "",
          source_company:       "",
          source_quote:         null,
          debate_verdict:       debate.debate_verdict as string,
          gemini_verdict:       "BULL",
          deepseek_verdict:     "BULL",
          probability_score:    probability,
          market_miss:          (debate.market_miss as string) || "",
          invalidation_trigger: (debate.invalidation as string) || "",
          snap,
          full_report_md:       debate.vault_path as string | null,
          is_premium:           tier === 1 || overallScore >= 85,
          asymmetry_score:      scores.asymmetry,
          conviction_score:     scores.conviction,
          catalyst_score:       scores.catalyst,
          management_score:     scores.management,
          target_price:         targetPrice,
          floor_price:          floorPrice,
          upside_pct:           upsidePct,
          downside_pct:         downsidePct,
        };

        const { error: insertErr } = await supabase
          .from("opportunity_feed")
          .upsert(feedRow, { onConflict: "conviction_debate_id" });

        if (insertErr) {
          console.error(`[feed] insert error for ${ticker}: ${insertErr.message}`);
        } else {
          console.log(`[feed] published ${ticker} (score ${overallScore.toFixed(0)}, tier ${tier})`);
          published.push({ ticker, score: overallScore, tier });
        }
      } catch (e) {
        console.error(`[feed] error processing debate ${debate.id}: ${String(e)}`);
      }
    }

    return Response.json({ status: "ok", published });

  } catch (e) {
    console.error(`[publish-to-feed] fatal: ${String(e)}`);
    return Response.json({ status: "error", error: String(e) }, { status: 500 });
  }
});
