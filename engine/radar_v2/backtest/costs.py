def spread_haircut(average_daily_value: float) -> float:
    if average_daily_value > 10_000_000:
        return 0.001 * 2
    if average_daily_value >= 1_000_000:
        return 0.0035 * 2
    return 0.0075 * 2
