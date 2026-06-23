from datetime import datetime, timezone

import pytest

from radar_v2.signals.adapters import form4_insider, sec_8k
from radar_v2.signals.schema import CATEGORIES, Signal


def test_signal_validates_and_serializes_utc_event_time():
    sig = Signal(
        ticker="ktos",
        signal_type="gov_contract_award",
        category="GOVERNMENT_REGULATORY",
        direction=1,
        magnitude=0.72,
        confidence=0.91,
        event_time=datetime(2026, 6, 1, 13, 30, tzinfo=timezone.utc),
        half_life_days=21,
        source_url="https://sec.gov/example",
        evidence="$KTOS disclosed a material government contract.",
        raw={"accession": "0001"},
    )

    sig.validate()
    payload = sig.to_dict()

    assert payload["ticker"] == "KTOS"
    assert payload["category"] in CATEGORIES
    assert payload["event_time"] == "2026-06-01T13:30:00+00:00"
    assert payload["dedupe_key"] == "KTOS:gov_contract_award:https://sec.gov/example"


def test_signal_rejects_naive_event_time():
    sig = Signal(
        ticker="KTOS",
        signal_type="sec_8k_material",
        category="COMMERCIAL_DEALS",
        direction=1,
        magnitude=0.5,
        confidence=0.8,
        event_time=datetime(2026, 6, 1),
        half_life_days=10,
        source_url="https://sec.gov/example",
        evidence="A material 8-K was filed.",
    )

    with pytest.raises(ValueError, match="timezone-aware UTC"):
        sig.validate()


def test_sec_8k_adapter_maps_filing_to_signal():
    filing = {
        "ticker": "KTOS",
        "form_type": "8-K",
        "filed_at": "2026-06-01",
        "category": "government contract",
        "matched": "contract award",
        "filing_url": "https://www.sec.gov/Archives/example",
        "accession": "0001",
    }

    signals = sec_8k.signals_from_filings([filing])

    assert len(signals) == 1
    sig = signals[0]
    assert sig.signal_type == "sec_8k_material"
    assert sig.category == "GOVERNMENT_REGULATORY"
    assert sig.half_life_days == 10
    assert sig.evidence == "$KTOS filed an 8-K tied to government contract: contract award."


def test_form4_adapter_emits_cluster_buy_and_unplanned_sale():
    scan_result = {
        "ticker": "RKLB",
        "transactions": [
            {
                "code": "P",
                "filer": "Alice CEO",
                "role": "CEO",
                "value": 450000,
                "date": "2026-06-02",
                "filing_url": "https://sec.gov/form4-buy-1",
                "is_10b5_1": False,
            },
            {
                "code": "P",
                "filer": "Bob Director",
                "role": "Director",
                "value": 350000,
                "date": "2026-06-03",
                "filing_url": "https://sec.gov/form4-buy-2",
                "is_10b5_1": False,
            },
            {
                "code": "S",
                "filer": "Carol Officer",
                "role": "Officer",
                "value": 150000,
                "date": "2026-06-04",
                "filing_url": "https://sec.gov/form4-sale",
                "is_10b5_1": False,
            },
        ],
    }

    signals = form4_insider.signals_from_scan_results([scan_result])

    assert [s.signal_type for s in signals] == ["insider_cluster_buy", "insider_sale_unplanned"]
    assert signals[0].direction == 1
    assert signals[0].magnitude == pytest.approx(0.5333333333)
    assert signals[1].direction == -1


def test_adapter_fetch_is_idempotent_with_injected_scan_result():
    now = datetime(2026, 6, 10, tzinfo=timezone.utc)

    def fake_scan(tickers, days):
        return [
            {
                "ticker": "KTOS",
                "form_type": "8-K",
                "filed_at": "2026-06-01",
                "category": "partnership/contract",
                "matched": "material definitive agreement",
                "filing_url": "https://sec.gov/a",
            }
        ]

    first = sec_8k.fetch(["KTOS"], since=now, scan_func=fake_scan)
    second = sec_8k.fetch(["KTOS"], since=now, scan_func=fake_scan)

    assert [s.dedupe_key for s in first] == [s.dedupe_key for s in second]
