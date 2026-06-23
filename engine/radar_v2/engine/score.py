import math
from datetime import datetime, timezone
from typing import Any

from radar_v2.signals.schema import CATEGORIES, Signal


WEIGHTS = {
    "INSIDER_SMART_MONEY": 0.22,
    "GOVERNMENT_REGULATORY": 0.18,
    "COMMERCIAL_DEALS": 0.16,
    "FUNDAMENTALS_INFLECTION": 0.18,
    "STREET_POSITIONING": 0.12,
    "PRICE_VOLUME_STRUCTURE": 0.10,
    "NARRATIVE_SENTIMENT": 0.04,
    "CONTEXT_REGIME": 0.00,
}


def signal_score(sig: Signal, now: datetime) -> float:
    sig.validate()
    age_days = (now.astimezone(timezone.utc) - sig.event_time).total_seconds() / 86400
    decay = math.exp(-math.log(2) * max(0, age_days) / sig.half_life_days)
    return sig.direction * sig.magnitude * sig.confidence * decay


def category_score(scores: list[float]) -> float:
    bulls = sorted((s for s in scores if s > 0), reverse=True)
    bears = sorted((abs(s) for s in scores if s < 0), reverse=True)

    def saturate(vals: list[float]) -> float:
        total = 0.0
        weight = 1.0
        for value in vals:
            total += value * weight
            weight *= 0.5
        return min(1.0, total)

    return saturate(bulls) - saturate(bears)


def confluence_multiplier(category_scores: dict[str, float]) -> dict[str, Any]:
    eligible = [
        category
        for category, score in category_scores.items()
        if score >= 0.25 and category not in ("NARRATIVE_SENTIMENT", "CONTEXT_REGIME")
    ]
    k = len(eligible)
    return {
        "k": k,
        "multiplier": min(2.0, 1.0 + 0.25 * max(0, k - 1)),
        "triple_signal": k >= 3,
        "categories": eligible,
    }


def score_ticker(
    ticker: str,
    signals: list[Signal],
    *,
    now: datetime | None = None,
    crowding_value: float = 0.0,
    reprice_gap: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    scores_by_category: dict[str, list[float]] = {category: [] for category in CATEGORIES}
    ledger = []
    regime_flags = []

    for sig in signals:
        decayed = signal_score(sig, now)
        scores_by_category[sig.category].append(decayed)
        if sig.category == "CONTEXT_REGIME":
            regime_flags.append(sig.signal_type)
        ledger.append({
            "type": sig.signal_type,
            "category": sig.category,
            "evidence": sig.evidence,
            "source_url": sig.source_url,
            "decayed_score": decayed,
            "age_days": max(0, (now - sig.event_time).total_seconds() / 86400),
            "direction": sig.direction,
        })

    category_scores = {
        category: category_score(scores)
        for category, scores in scores_by_category.items()
    }
    weighted = sum(max(0.0, score) * WEIGHTS[category] for category, score in category_scores.items())
    confluence = confluence_multiplier(category_scores)
    crowding = max(0.0, min(1.0, crowding_value))
    penalty = 1 - 0.5 * crowding
    raw_score = weighted * confluence["multiplier"] * penalty
    radar_score = round(max(0.0, min(100.0, raw_score * 100)))

    return {
        "ticker": ticker.upper(),
        "radar_score": radar_score,
        "gate_pass": radar_score >= 75,
        "category_scores": category_scores,
        "confluence": confluence,
        "crowding": {"value": crowding, "penalty_applied": penalty},
        "signals": ledger,
        "regime_flags": regime_flags,
        "reprice_gap": reprice_gap,
    }
