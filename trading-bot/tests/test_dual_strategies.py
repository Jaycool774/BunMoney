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
        prices = [100]*20 + [98,97,101,103,95,97,97,100,104,98,95,99,98,101,104,104,104,105,95,97,105]
        result = evaluate(candles(prices))
        self.assertIsNotNone(result)
        self.assertEqual((result.strategy, result.side), ('patient', 'buy'))
        self.assertIn('SMA20', result.reason)

    def test_no_future_data(self):
        base = [100]*40+[110]
        self.assertEqual(evaluate(candles(base)), evaluate(candles(list(base))))


if __name__ == '__main__':
    unittest.main()
