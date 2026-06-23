from datetime import datetime, timezone

from radar_v2.signals.schema import Signal


def vix_regime_flag(ticker: str, vix_level: float, now: datetime | None = None) -> Signal | None:
    if vix_level < 25:
        return None
    return Signal(
        ticker=ticker,
        signal_type="VIX_ELEVATED",
        category="CONTEXT_REGIME",
        direction=-1,
        magnitude=min(1.0, (vix_level - 20) / 30),
        confidence=1.0,
        event_time=now or datetime.now(timezone.utc),
        half_life_days=1,
        source_url="https://fred.stlouisfed.org/series/VIXCLS",
        evidence=f"VIX is elevated at {vix_level:.1f}.",
        raw={"vix_level": vix_level},
    )
