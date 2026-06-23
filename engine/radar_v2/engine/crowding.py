def crowding_value(news_z: float = 0.0, social_z: float = 0.0, move_z: float = 0.0) -> float:
    positives = [max(0.0, value) for value in (news_z, social_z, move_z)]
    return max(0.0, min(1.0, sum(positives) / 9.0))
