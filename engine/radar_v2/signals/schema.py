from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


CATEGORIES = [
    "INSIDER_SMART_MONEY",
    "GOVERNMENT_REGULATORY",
    "COMMERCIAL_DEALS",
    "FUNDAMENTALS_INFLECTION",
    "STREET_POSITIONING",
    "PRICE_VOLUME_STRUCTURE",
    "NARRATIVE_SENTIMENT",
    "CONTEXT_REGIME",
]


@dataclass(frozen=True)
class Signal:
    ticker: str
    signal_type: str
    category: str
    direction: int
    magnitude: float
    confidence: float
    event_time: datetime
    half_life_days: float
    source_url: str
    evidence: str
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def dedupe_key(self) -> str:
        return f"{self.ticker.upper()}:{self.signal_type}:{self.source_url}"

    def validate(self) -> None:
        if self.category not in CATEGORIES:
            raise ValueError(f"bad category {self.category}")
        if self.direction not in (-1, 1):
            raise ValueError("direction must be -1 or 1")
        if not 0.0 <= self.magnitude <= 1.0:
            raise ValueError("magnitude must be 0.0-1.0")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be 0.0-1.0")
        if self.event_time.tzinfo is None or self.event_time.utcoffset() is None:
            raise ValueError("event_time must be timezone-aware UTC")
        if self.event_time.utcoffset() != timezone.utc.utcoffset(self.event_time):
            raise ValueError("event_time must be timezone-aware UTC")
        if self.half_life_days <= 0:
            raise ValueError("half_life_days must be positive")
        if not self.evidence:
            raise ValueError("evidence is required")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return {
            "ticker": self.ticker.upper(),
            "signal_type": self.signal_type,
            "category": self.category,
            "direction": self.direction,
            "magnitude": self.magnitude,
            "confidence": self.confidence,
            "event_time": self.event_time.isoformat(),
            "half_life_days": self.half_life_days,
            "source_url": self.source_url,
            "evidence": self.evidence,
            "raw": self.raw,
            "dedupe_key": self.dedupe_key,
        }
