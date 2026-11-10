"""Deterministic, paper-only strategies using completed five-minute candles.

Quick: SMA(10/20) cross. Patient: SMA(20/40) cross confirmed by
the 10-bar price trend. One signal per symbol/bar, with quick priority.
No forecasts, broker calls, or hidden lookahead.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    side: str
    strategy: str
    reason: str


def evaluate(candles):
    if len(candles) < 41:
        # Preserve the original 21-candle quick strategy.
        if len(candles) < 21:
            return None
        closes = [c.close for c in candles[-21:]]
        before = sum(closes[-11:-1])/10 - sum(closes[-21:-1])/20
        after = sum(closes[-10:])/10 - sum(closes[-20:])/20
        if before <= 0 < after:
            return Decision('buy','quick','SMA10 crossed above SMA20 on completed 5-minute candles')
        if before >= 0 > after:
            return Decision('sell','quick','SMA10 crossed below SMA20 on completed 5-minute candles')
        return None

    closes = [c.close for c in candles[-41:]]
    qprev = sum(closes[-11:-1])/10 - sum(closes[-21:-1])/20
    qnow = sum(closes[-10:])/10 - sum(closes[-20:])/20
    if qprev <= 0 < qnow:
        return Decision('buy','quick','SMA10 crossed above SMA20 on completed 5-minute candles')
    if qprev >= 0 > qnow:
        return Decision('sell','quick','SMA10 crossed below SMA20 on completed 5-minute candles')
    pprev = sum(closes[-21:-1])/20 - sum(closes[-41:-1])/40
    pnow = sum(closes[-20:])/20 - sum(closes[-40:])/40
    if pprev <= 0 < pnow and closes[-1] > closes[-11]:
        return Decision('buy','patient','SMA20 crossed above SMA40; price rose over the last 10 completed bars')
    if pprev >= 0 > pnow and closes[-1] < closes[-11]:
        return Decision('sell','patient','SMA20 crossed below SMA40; price fell over the last 10 completed bars')
    return None
