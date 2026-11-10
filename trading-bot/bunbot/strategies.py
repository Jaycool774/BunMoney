"""Deterministic, completed-candle paper-only strategy selection.

Both strategies use the same five-minute candles; patient is not advertised as
a true hourly strategy until higher-timeframe feeds are implemented.
"""
def choose(candles):
    if len(candles) < 21:
        return None
    prices = [float(c.close) for c in candles]
    if any(p <= 0 for p in prices[-21:]):
        return None
    def cross(short, long):
        before = sum(prices[-short-1:-1])/short - sum(prices[-long-1:-1])/long
        after = sum(prices[-short:])/short - sum(prices[-long:])/long
        return 'buy' if before <= 0 < after else 'sell' if before >= 0 > after else None
    # Patient takes precedence when both trigger on the same completed bar.
    patient = cross(10, 20)
    if patient:
        return {'side':patient,'strategy':'patient','explanation':'SMA10/SMA20 crossover on completed 5-minute candles; patient trend setup'}
    quick = cross(5, 8)
    if quick:
        return {'side':quick,'strategy':'quick','explanation':'SMA5/SMA8 crossover on completed 5-minute candles; quick setup'}
    return None
