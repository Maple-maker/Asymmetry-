def compute_reprice_gap(
    signal_type: str,
    days_elapsed: int,
    realized_abnormal_move: float,
    drift_curves: dict,
    horizon: int = 63,
) -> dict[str, float]:
    curve = drift_curves.get(signal_type, {})
    expected_total = float(curve.get(str(horizon), 0.0))
    reprice_gap = expected_total - realized_abnormal_move
    return {
        "expected_drift_remaining_pct": round(reprice_gap * 100, 2),
        "window_elapsed_pct": round(min(1.0, max(0, days_elapsed) / horizon) * 100, 2),
    }
