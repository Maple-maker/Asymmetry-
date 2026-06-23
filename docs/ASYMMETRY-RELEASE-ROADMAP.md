---
title: Asymmetry — iOS Release Roadmap (Handoff)
date: 2026-06-23
status: active
audience: any model/agent picking up the build cold
---

# Asymmetry → iOS Release Roadmap (Handoff Doc)

## Context

"Asymmetry" is the **engine upgrade to the Thesis iOS app** — not a new app. Per the
2026-06-23 spec-lock + pivot, we keep **Thesis's branding, front-end, and App Store identity**
and graft in two new backend engines plus a portfolio layer:

1. **Rubric engine** (TypeScript, in the Thesis server `server/lib/rubric/`) — the transparent
   0–100 scorecard + capital-deploy surface, generalized from MarketPulse `lib/spcx/`.
2. **Radar V2** (Python service) — the deep 28-signal analysis + screening core, ported from
   No-Fomo `backend/radar_v2/`.
3. **Portfolio Intelligence** — SnapTrade-linked holdings (read-only), each scored by the rubric
   (fed by Radar V2), with market-open/close push + on-device audio briefs.

The Thesis base is already **most of the way to the App Store**: managed Expo app, EAS pipeline
configured, ASC app record assigned, Plaid endpoints already built, and existing app-review /
launch-day docs. So this roadmap is **"add the engines + scorecard UI + ship to TestFlight,"**
not "build infra from scratch."

### Decisions locked this session
| Decision | Value |
|---|---|
| App identity | **Reuse existing Thesis identity** — bundle `com.makeyourthesis.app`, ASC app `6775985719`, EAS project `d25b92e4-cca0-4231-995e-827934fe51a6`. No rebrand. |
| Release target | **TestFlight beta first**, App Store public as a later phase |
| Subscriptions | **Post-launch** — ship free; keep the in-memory Pro stub (`server/src/entitlements.ts`); real IAP/RevenueCat is a follow-on |
| Holdings provider | **SnapTrade** (read-only brokerage holdings) — reverted from Plaid (2026-06-23). `connected_accounts.snaptrade_*`; `snaptrade_user_secret` service-role only. |
| Brief audio (M6) | **On-device TTS** (`AVSpeechSynthesizer`) for beta — free, no key, no audio storage. **ElevenLabs = post-launch premium-tier voice** (the JARVIS clone). |
| Foundation | Thesis-as-base (Expo SDK 56 / RN 0.85 / TS strict / NativeWind v4 / Zustand). Managed workflow — **no native `ios/` dir**; EAS builds. |

---

## Repo & infra ground truth (so any model can start cold)

| Thing | Location / value |
|---|---|
| Working repo | `~/Projects/Asymmetry` → remote `origin` = `github.com/Maple-maker/Asymmetry-` (now holds full Thesis history) |
| Thesis upstream | remote `thesis` = `github.com/Maple-maker/thesis`; also cloned at `~/Projects/thesis`. Pull updates: `git pull thesis main` |
| Client | Expo SDK ~56.0.6, RN 0.85.3, TS strict, NativeWind v4, Zustand + AsyncStorage. Entry `expo-router/entry`. |
| Server | `server/` — Express + TS, run with `tsx`. Deployed to **Fly.dev** (`thesis-server-beta.fly.dev`), `server/fly.toml` + `Dockerfile` present. Deps: express, cors, zod, otplib, yahoo-finance2. **No test runner yet.** |
| Existing server modules to reuse | `server/src/snaptrade.ts` (M2 holdings; reworked from the old `plaid.ts`), `supabase.ts` (service-role client), `entitlements.ts` (Pro stub), `market*.ts`, `macro.ts`, `llm*.ts`, `tools/` (fred, treasury, macro-news) |
| iOS release config | `eas.json` (production + development profiles, `autoIncrement`), `app.json`/`app.config.js` (`ITSAppUsesNonExemptEncryption:false` already set) |
| Existing release docs (reuse) | `docs/app-review-guide.md`, `docs/launch-day-checklist.md`, `docs/subscription-and-backend.md`, `docs/plaid-integration.md`, `docs/marketing-plan.md`, `docs/ops-todo.md` |
| Rubric port source | `…/AEGIS/30-PROJECTS/active/MarketPulse/lib/spcx/` (uses vitest) |
| Radar V2 port source | No-Fomo `backend/radar_v2/` + `sec_scanner.py`, `sec_8k.py`, `supply_chain_mapper.py` (confirm local path / clone No-Fomo) |
| Persistence | One Supabase project (Postgres + RLS). Migration to rebase: `supabase/migrations/0001_init.sql` |

---

## Milestone roadmap

Phasing: **M0–M3 = rubric scorecard surface over linked holdings** (the TestFlight beta cutline).
**M4–M5 = deep Radar V2 engine + screener** (full v1). **M6 = daily briefs. M7 = ship.**

### M0 — Reconcile base to the pivot
Graft the engine homes into the Thesis repo; rebase the schema.
- Add a Python `engine/` dir as the Radar V2 home (port target). The Thesis base is managed Expo —
  **there is no SwiftUI `ios/` to delete** (that concern was the old `repo-seed/`, now superseded).
- Rebase `supabase/migrations/0001_init.sql` to the SnapTrade + rubric data model (see Schema below).
- **DoD:** repo builds + runs in simulator (`npm run ios:sim`); `supabase db push` applies clean;
  Python `engine/` boots.

### M1 — Rubric engine port + generalization (immediate build)
Port the proven primitives, then build the multi-stock layer the rubric-spec defines.
- Add **vitest** to `server/` (the base has no test runner; spcx tests are vitest).
- **Port verbatim** from `MarketPulse/lib/spcx/` → `server/lib/rubric/`:
  `score.ts` (`computeWeightedTotal`), `merge.ts` (`mergeScores`), `deploy.ts`
  (`decideAction` ≥85/≥75/≥65 tiers + `computeDeploy` −15%/−25% DCA boosts, 25%/30% concentration
  caps), `autoscore.ts` (52-wk valuation, financial rubric, liquidity neutral), `schedule.ts`
  + their `*.test.ts`.
- **Build net-new** (do not exist in spcx — spcx is SpaceX-specific):
  - `types.ts` — `SourceClass = 'auto'|'partial'|'judgment'`, category/rubric types.
  - `base.ts` — the 5-spine universal base: `valuation`, `financial`, `liquidity` (auto/partial),
    `execution`, `moat` (judgment).
  - `industry.ts` — `resolveIndustry()` over the curated ~15-key taxonomy
    (`aerospace_defense`, `semiconductors`, `software`, `banks`, `energy`, `biotech`,
    `consumer_retail`, `industrials`, `utilities`, `materials`, `telecom`, `reits`, `transport`,
    `media_entertainment`, `auto_ev`).
  - `compose.ts` — **base-fill rule (LOCKED):** overlay authored to sum < 100; base scales
    proportionally to fill `100 − overlaySum`; final must sum to **100 ± 0.01 or throw**. No silent
    renormalization.
- Seed `rubric_base` (5 spine) + `aerospace_defense` overlay.
- **DoD:** `compose`/`score`/`merge`/`industry`/`deploy` tests green; a composed rubric sums to 100;
  `deploy.ts` behavior unchanged from spcx fixtures.

### M2 — SnapTrade holdings ingest (read-only)
Reworked from Plaid → SnapTrade (`server/src/snaptrade.ts`).
- Register SnapTrade user (`userId`+`userSecret`) → connection-portal URL → user links brokerage
  read-only → read positions → map to `holdings`. `snaptrade_user_secret` stays server-side
  (service-role only), never in any response.
- **DoD:** SnapTrade connect → read positions (never a write/trade scope) → holdings populate.
  **Read-only only — no order placement.**
- **Verify needs:** `SNAPTRADE_CLIENT_ID` + `SNAPTRADE_CONSUMER_KEY`.

### M3 — Per-holding scorecard
- Run the M1 rubric over each holding → `holding_scorecards` (total, per-category, action tier, deploy).
- Build the RN scorecard panel (port the *pattern* from MarketPulse `components/spcx/`, rebuild in RN).
- **DoD:** a linked holding renders a scorecard summing to 100 with correct action tier + deploy,
  persisted; tests green. **← This is the minimum TestFlight beta surface.**

### M4 — Radar V2: free-source signals
Port No-Fomo `backend/radar_v2/` into `engine/`. Free feeds first.
- Signal schema + adapters: **SEC EDGAR / Form 4 / USAspending / Yahoo / macro / news** (all free).
- Scoring engine → 28-signal RadarScore → **gate ≥75 before any AI call** → write
  `radar_opportunities` (shared) + `holding_snapshots` (per-user).
- **DoD:** a ticker scores → rows with RadarScore + ranked signals; the ≥75 gate filters before AI.

### M5 — Radar V2: depth + composition
- AI Council (falsifiable thesis + invalidation conditions), Reprice Gap, backtest harness.
- Keyed adapters as keys land: **FMP** (fundamentals), **Finnhub** (analyst/short interest +
  `profile2` for industry resolution).
- Wire Radar V2 categories into the rubric's auto/partial categories:
  FUNDAMENTALS→`financial`, STREET_POSITIONING→`liquidity`, PRICE_VOLUME→`valuation`;
  GOV/DEALS/INSIDER → industry-overlay factors. Macro = annotation only (weight 0.0).
- Deep-signal panel on holding detail; screener → `thesis_matches`.
- **DoD:** AI Council emits falsifiable thesis; Reprice Gap comes from the harness (not asserted);
  Radar signals populate the rubric on a real holding; screener writes `thesis_matches`.

### M6 — Daily briefs
- Market-open (~9:25 ET) + close (~4:05 ET) APNs push: AI brief **text** (server-generated) spoken
  **on-device via `AVSpeechSynthesizer`** — free, no key, no audio storage, lock-screen / CarPlay
  playable. `briefs.audio_url` stays nullable/unused in beta.
- **DoD:** at the open trigger, a brief row has `text`; the app speaks it on-device from the lock screen.
- **Post-launch (premium tier):** swap to pre-rendered **ElevenLabs** audio (JARVIS voice) → populate
  `briefs.audio_url`; text-only still ships if generation fails.

### M7 — Ship to TestFlight (beta)
- Ship-check (typecheck, lint, rubric tests, manual sim pass against `docs/launch-day-checklist.md`).
- Deploy server to Fly.dev; confirm `EXPO_PUBLIC_THESIS_API_URL` in the EAS production profile.
- Build + submit (see Release mechanics below).
- **DoD:** EAS production build accepted; TestFlight build available to internal testers.
- **Deferred (post-beta):** public App Store submission, real IAP/RevenueCat subscription tiers.

### Recommended TestFlight beta cutline
Beta does **not** need the full 28-signal depth. Ship **M0–M3** (rubric scorecard over linked
holdings) — optionally **M4** (free-source signals) and **M6** (briefs) if time allows. **M5**
(AI Council, Reprice Gap, backtest, keyed feeds, screener) can land in a beta update. The vault
memory targets a free beta ~July 1, 2026 — M4–M5 are unlikely to make that date; **M1–M3 is the
realistic beta scope.**

---

## Two-engine composition (one glance)
```
Thesis funnel (formulate) ── existing front-end, kept

SnapTrade holdings ─┐
                    ├─► RADAR V2 (Python) ─ 28 signals → RadarScore → gate ≥75 → AI Council
discovery WL ──────┘   one engine, two universes    → Reprice Gap → backtest
                                  │ (signals feed auto/partial categories — via Supabase, async)
                                  ▼
                     RUBRIC ENGINE (TS, server/lib/rubric/)
                     resolveIndustry → composeRubric → mergeScores → computeWeightedTotal
                                     → decideAction → computeDeploy
                                  ▼
                     per-holding SCORECARD (0–100 + tier + deploy) + deep-signal panel + Reprice Gap
                                  ▼
                     APNs push + on-device audio brief (open ~9:25 / close ~4:05 ET)
```
**Integration seam = Supabase.** Python writes scored signals; TS reads. No synchronous TS↔Python
call on the request path.

---

## Supabase schema (rebase `0001_init.sql`)
Keep: `holding_snapshots`, `radar_opportunities`, `thesis_matches` (already in the seed).
Add/rebase to SnapTrade + rubric:

- `rubric_base(key pk, label, weight, source_class, derivation)` — 5-spine reference, service-role write.
- `rubric_industry(industry_key, categories jsonb, origin 'authored'|'ai_draft'|'ai_promoted', updated_at)` — ~15 overlays; Layer C `ai_draft` >90 days is stale until human-promoted.
- `connected_accounts(... provider 'snaptrade', snaptrade_user_id, snaptrade_user_secret [RLS service-role only], snaptrade_authorization_id, brokerage, account_id, status, last_synced_at)`.
- `holdings(user_id, account_id, ticker, quantity, cost_basis, market_value, currency, thesis_id, updated_at)`.
- `holding_scorecards(holding_id, user_id, ticker, score_date, industry_key, total, total_delta, action, category_scores jsonb, deploy jsonb)` — append-only.
- `holding_snapshots(holding_id, user_id, ticker, snapshot_date, radar_score, score_delta, reprice_gap, top_signals jsonb)` — append-only.
- `radar_opportunities(ticker, radar_score, reprice_gap, top_signals jsonb, as_of, unique(ticker, as_of))` — shared feed, no user_id.
- `thesis_matches(user_id, thesis_id, ticker, radar_score, reprice_gap, rationale jsonb, matched_at)`.
- `briefs(user_id, session, brief_date, text, audio_url, delivered_at)`.

**RLS:** every user-owned table; `snaptrade_user_secret` service-role only; `rubric_*` and
`radar_opportunities` are shared reference/feed (auth read, service-role write).

---

## Compliance constraints (NON-NEGOTIABLE — apply to every milestone)
1. **Read-only.** Never places/modifies an order; the LLM never types an order. SnapTrade read-only scope only (no trade/order endpoints).
2. **Educational, not advice.** Preserve Thesis's regulatory framing. Scorecard/signals/deploy are illustrative analysis.
3. **Regime/macro flags annotate, never rank** (weight 0.0).
4. **Narrative sentiment capped at weight 0.04.**
5. **Bear cases are sizing annotations, never ranking inputs.**
6. **No backtest number ships unless the harness produced it** (Reprice Gap must be auditable).
7. **Rubric fully auditable** — every score traces to category + weight + source class.
8. **AI fills gaps, never overrides** — Layer C drafts are `ai_draft` until human-promoted.
9. **Composed weights sum to 100 (±0.01) or throw** — no silent renormalization.

---

## Data-feed dependencies by milestone
| Feed | Source | Cost | Needed by |
|---|---|---|---|
| Holdings | SnapTrade (read-only positions) | keyed (client_id + consumer_key) | M2 |
| Form 4 / 13F / 8-K | SEC EDGAR | free | M4 |
| Gov contracts/grants | USAspending / SAM.gov | free | M4 |
| Price/volume/valuation | Yahoo / yfinance | free | M4 |
| News velocity | RSS / news API | free | M4 |
| Macro/regime | No-Fomo macro scraper | free | M4 |
| Fundamentals/earnings | **FMP** | keyed (confirm) | M5 |
| Analyst/short interest + industry resolve | **Finnhub** (`profile2`) | keyed (confirm) | M5 |
| Audio narration (beta) | On-device `AVSpeechSynthesizer` | **free, no key** | M6 |
| Audio narration (premium, post-launch) | ElevenLabs (JARVIS voice) | keyed | post-M7 |

**Open input:** confirm which keyed feeds (FMP, Finnhub) you already hold — drives how much of the
28-signal catalog lights up in M4 vs M5.

---

## Release mechanics (TestFlight)
Managed Expo + EAS; no local Xcode archive needed.
- Prereqs: `npm i -g eas-cli`; `eas login`; Apple Developer account access for ASC app `6775985719`.
- Server first: deploy `server/` to Fly.dev (`fly deploy` from `server/`); verify the production URL
  in `eas.json` (`EXPO_PUBLIC_THESIS_API_URL`).
- Build: `eas build --platform ios --profile production` (auto-increments build number).
- Submit to TestFlight: `eas submit --platform ios --latest` (uses `submit.production.ios.ascAppId`).
- Smoke against `docs/launch-day-checklist.md`; add testers in App Store Connect → TestFlight.

### Secrets / config inventory to confirm before M2/M6/M7
- Supabase URL + anon + **service-role** key (service-role server-side only).
- SnapTrade `SNAPTRADE_CLIENT_ID` + `SNAPTRADE_CONSUMER_KEY` (read-only).
- FMP + Finnhub keys (M5). **No audio key for beta** — on-device TTS. ElevenLabs key + voice id only for the post-launch premium voice.
- `EXPO_PUBLIC_THESIS_APP_KEY` (already in `eas.json`), APNs key/cert for push (M6).
- **Audit:** the `eas.json` currently embeds `EXPO_PUBLIC_THESIS_APP_KEY` in plaintext (inherited
  from Thesis). It's a public-prefixed shared secret, but flag for review before public release.

---

## Verification (end-to-end)
- **M1:** `cd server && npx vitest run lib/rubric` → all green; assert a composed `aerospace_defense`
  rubric sums to 100 and a known holding yields the expected action tier + deploy.
- **M2:** complete a SnapTrade connection → confirm `holdings` rows populate; grep server logs to
  confirm `snaptrade_user_secret` stays server-side and only read-only endpoints are called.
- **M3:** open the app in simulator (`npm run ios:sim`) → a holding shows a scorecard summing to 100
  with tier + deploy; confirm a `holding_scorecards` row written.
- **M4:** run the Python engine on a test ticker → `radar_opportunities`/`holding_snapshots` rows with
  RadarScore; confirm the ≥75 gate runs before any AI call.
- **M6:** trigger an open brief → row has `text`; the app speaks it on-device from the lock screen.
- **M7:** `eas build` succeeds, `eas submit` lands in TestFlight, internal tester installs and runs the
  M0–M3 flow on device.

---

## Open items to resolve (flagged, not blocking the doc)
1. Confirm FMP / Finnhub keys held (gates M4 vs M5 coverage). **[CONFIRMED 2026-06-23: neither key held — M5 fundamentals/analyst coverage blocked; M4 free-source is fully unblocked. Keys held: Polygon, SAM.gov, Exa, Supabase, LLM providers.]**
2. ~~Confirm No-Fomo `backend/radar_v2/` local path~~ **[RESOLVED: `…/active/No-Fomo/NoFomo/backend/radar_v2/` — ported into `engine/`. See `docs/radar-v2-port-plan.md`.]**
3. Confirm Thesis base already has Apple Sign-In + APNs, or port from No-Fomo (needed for M6 push).
4. Industry resolution provider — lean Finnhub `profile2` (matches MarketPulse). **(Needs Finnhub key — see #1.)**
5. **Build/deploy wiring (M7 debt):** M3 changed `server/tsconfig.json` `rootDir` `"src"`→`"."` so `src/` can import `lib/rubric/`. Consequence: `npm run build` now emits `dist/src/index.js` (not `dist/index.js`). Before deploy, update the `start` script + `server/Dockerfile` (`CMD` path **and** `COPY lib/` so the engine ships). Dev loop (`tsx watch`, vitest) is unaffected.
6. **Holdings provider = SnapTrade** (read-only), reverted from Plaid 2026-06-23. M2 reworked to SnapTrade; `connected_accounts.snaptrade_*`. Needs `SNAPTRADE_CLIENT_ID` + `SNAPTRADE_CONSUMER_KEY` to verify live.
7. **`holdings` upsert:** no unique constraint on `(user_id, account_id, ticker)`; M2 uses delete-then-insert on refresh. Add the constraint in a follow-up migration if true key-upsert is wanted.
8. **M6 audio = on-device TTS** (`AVSpeechSynthesizer`) for beta — free, no key. ElevenLabs (JARVIS voice) is the post-launch premium-tier upgrade.

---

## Cross-references
- `2026-06-23-asymmetry-product-spec.md` — north-star spec (source of truth)
- `2026-06-23-rubric-engine-spec.md` — shared rubric engine spec
- `2026-06-23-multi-stock-industry-rubric.md` — rubric port implementation plan
- `2026-06-23-session-rollup.md` — the spec-lock session this roadmap follows
