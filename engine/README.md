# Radar V2 Signal Engine (M4)

The deterministic catalyst-detection engine for Asymmetry. Many data adapters
emit one shared `Signal` schema; a pure-function scoring engine fuses them into a
0–100 **RadarScore** with a full, auditable breakdown — **before any AI/LLM call**.

Ported from No-Fomo (`backend/radar_v2/`). This is roadmap milestone **M4**
(free-source signals). M5 (FMP/Finnhub adapters, backtest harness, AI Council)
is deliberately out of scope here — see "Deferred" below.

## Layout

```
engine/
  requirements.txt        # runtime deps
  pyproject.toml          # makes radar_v2 importable + pytest config
  README.md               # this file
  radar_v2/
    signals/
      schema.py           # Signal dataclass + validate() — the contract (PORTED VERBATIM)
      adapters/
        sec_8k.py         # PORTED — SEC 8-K material events (free)
        form4_insider.py  # PORTED — Form 4 insider cluster-buy / unplanned sale (free)
        usaspending.py    # NEW   — gov_contract_award (USAspending, free)
        momentum.py       # NEW   — momentum_12_1 (Yahoo/yfinance, free)
        volume_anomaly.py # NEW   — volume_anomaly (Yahoo/yfinance, free)
        short_interest.py # NEW   — short_interest_shift (free)
        openfda.py        # NEW   — fda_decision (openFDA, free)
        news_rss.py       # NEW   — news_velocity (RSS, free, weight-capped 0.04)
        regime_macro.py   # NEW   — VIX regime flag (free, weight 0.0 — annotation only)
        _http.py          # shared HTTP helper
    engine/
      score.py            # PORTED VERBATIM — decay→fusion→confluence→crowding, >=75 gate
      crowding.py         # PORTED VERBATIM
      regime.py           # PORTED VERBATIM
      reprice.py          # PORTED VERBATIM (consumes drift curves R3 will produce)
    backtest/             # PORTED VERBATIM (costs/event_study/report = R3 building blocks;
                          #   loader/drift_curves are stubs — full R3 harness is M5)
    legacy/               # the wrapped network scrapers (sec_scanner, insider_scraper, macro_scraper)
    run_scan.py           # PORTED + Supabase write seam + --full adapter set
    supabase_writer.py    # NEW — maps engine output → radar_opportunities / holding_snapshots
    tests/                # 3 ported test modules + 2 new (M4 adapters, supabase writer)
```

## Run

```bash
cd engine
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Tests (31 pass)
python -m pytest -q

# Dry-run scan — two SEC adapters only (default)
python -m radar_v2.run_scan --tickers KTOS --days 90

# Dry-run scan — ALL M4 free-source adapters
python -m radar_v2.run_scan --tickers KTOS LMT --days 90 --full

# Persist to Supabase (no-op unless credentials are set — see env below)
python -m radar_v2.run_scan --tickers KTOS --full --write
```

Each adapter is also runnable standalone, e.g.
`python -m radar_v2.signals.adapters.usaspending --tickers LMT --days 120 --json`.

## The ≥75 gate (compliance)

`score_ticker()` computes `gate_pass = radar_score >= 75`. This gate runs inside
the deterministic engine, **before** any AI/Council step. M4 contains no AI
calls. Other compliance rules enforced in code:

- **Regime/macro = annotation only** — `CONTEXT_REGIME` weight is `0.0`; a unit
  test proves regime signals cannot change a RadarScore.
- **Narrative capped** — `NARRATIVE_SENTIMENT` weight is `0.04`; a unit test
  proves narrative-only signals cannot pass the gate.
- **Read-only data** — every adapter only reads public sources.

## Environment variables

All keys are read from the environment (`.env`); none are hard-coded. **M4 needs
no API keys** — every adapter above uses a free source. Variables are only used
by the optional Supabase write seam:

| Var | Used by | Required? |
|---|---|---|
| `SUPABASE_URL` | `supabase_writer` | Only to actually persist; absent → no-op |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase_writer` | Only to actually persist; absent → no-op |
| `POLYGON_API_KEY` | (reserved — M5 backtest/history) | No (M4 uses free Yahoo) |
| `SAM_API_KEY` | (reserved — richer SAM.gov queries) | No (USAspending is keyless) |

Without `SUPABASE_*` set (or without the `supabase` pip package installed),
`run_scan --write` runs the full engine and prints what it *would* have written,
but performs no database I/O.

## Supabase write contract

`supabase_writer.py` maps `score_ticker()` output onto two tables:

- **`radar_opportunities`** (shared feed, service-role write / auth read):
  `ticker, radar_score, top_signals(jsonb), reprice_gap(jsonb), as_of,
  score_breakdown(jsonb), regime_flags(text[]), council_explanation(jsonb=null in M4)`.
  `unique(ticker, as_of)` → upsert is idempotent within a scan.
- **`holding_snapshots`** (per-user, append-only): one row per user-held ticker,
  with `score_delta = today − prior snapshot`. Built by `snapshot_row()`; the
  caller supplies the user/holding context.

## Deferred (out of M4 scope — see port plan)

- **FMP/Finnhub adapters** (`earnings_surprise`, `estimate_revision`,
  `analyst_action`, `valuation_gap`, `overreaction_reversal`, etc.) — blocked on
  keys not held. (M5)
- **Backtest harness R3** — `backtest/loader.py` + `drift_curves.py` are stubs;
  `reprice.py` consumes drift curves nothing produces yet. No Reprice Gap until
  R3 runs against real history. (M5)
- **AI Council R4** — lives in the TS server; `council_explanation` stays null
  until R4 writes it. (M5)
```
