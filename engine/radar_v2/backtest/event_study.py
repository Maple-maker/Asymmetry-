from datetime import datetime, timezone


class LookaheadError(ValueError):
    pass


def _session_open(row: dict) -> datetime:
    return datetime.fromisoformat(f"{row['date']}T13:30:00+00:00").astimezone(timezone.utc)


def event_return(event_time: datetime, prices: list[dict], horizon_days: int) -> float:
    event_time = event_time.astimezone(timezone.utc)
    ordered = sorted(prices, key=lambda row: row["date"])
    future_rows = [row for row in ordered if _session_open(row) > event_time]
    if not future_rows:
        raise LookaheadError("entry_time must be after public event_time")

    entry = future_rows[0]
    exit_index = min(horizon_days - 1, len(future_rows) - 1)
    exit_row = future_rows[exit_index]
    entry_price = float(entry["open"])
    exit_price = float(exit_row.get("close", exit_row["open"]))
    return (exit_price - entry_price) / entry_price


def abnormal_return(ticker_return: float, benchmark_return: float, cost: float = 0.0) -> float:
    return ticker_return - benchmark_return - cost
