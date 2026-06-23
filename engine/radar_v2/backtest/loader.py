def sector_benchmark_for_sector(sector: str) -> str:
    mapping = {
        "technology": "XLK",
        "industrials": "XLI",
        "healthcare": "XLV",
        "biotech": "XBI",
        "energy": "XLE",
        "financials": "XLF",
        "materials": "XLB",
        "utilities": "XLU",
    }
    return mapping.get(sector.lower(), "SPY")
