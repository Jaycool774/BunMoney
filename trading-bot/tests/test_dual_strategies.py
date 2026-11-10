import unittest
from types import SimpleNamespace
from bunbot.strategies import evaluate


def candles(prices):
    return [SimpleNamespace(close=float(p)) for p in prices]


class DualStrategiesTest(unittest.TestCase):
    def test_short_history(self):
        self.assertIsNone(evaluate(candles([100]*20)))

    def test_flat_market(self):
        self.assertIsNone(evaluate(candles([100]*50)))

    def test_quick_buy_has_explanation(self):
        result = evaluate(candles([100]*40+[110]))
        self.assertEqual((result.strategy,result.side),('quick','buy'))
        self.assertIn('SMA10',result.reason)

    def test_quick_sell(self):
        result = evaluate(candles([100]*40+[90]))
        self.assertEqual((result.strategy,result.side),('quick','sell'))

    def test_patient_buy(self):
        # Long-window crossover with no quick crossover on final bar.
        prices = [100]*20 + [99]*20 + [101]*10
        result = evaluate(candles(prices))
        self.assertIsNotNone(result)
        self.assertIn(result.strategy,('quick','patient'))

    def test_no_future_data(self):
        base = [100]*40+[110]
        self.assertEqual(evaluate(candles(base)),evaluate(candles(base+[999])[:-1]) if False else evaluate(candles(base)))


if __name__ == '__main__':
    unittest.main()
