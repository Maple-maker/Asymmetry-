from statistics import median


def median_drift_curve(events: list[dict], horizons: list[int]) -> dict[str, float]:
    curve: dict[str, float] = {}
    for horizon in horizons:
        values = [event["returns"][horizon] for event in events if horizon in event.get("returns", {})]
        if values:
            curve[str(horizon)] = median(values)
    return curve
