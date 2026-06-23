def render_honesty_guards(delisted_coverage: bool) -> str:
    survivorship = (
        "Delisted ticker coverage present."
        if delisted_coverage
        else "Survivorship warning: delisted tickers are missing, so results are optimistic."
    )
    return "\n".join([
        "Point-in-time assertion: every event_time < entry_time, embargo respected.",
        "Sample size rule: n < 30 is labeled INDICATIVE ONLY.",
        survivorship,
        "No in-sample weight tuning leakage: train and holdout windows are separated.",
        "Multiple-comparisons caution: signal winners with confidence intervals crossing zero are flagged.",
        "Regime split: high-VIX and low-VIX results are reported as annotations.",
    ])
