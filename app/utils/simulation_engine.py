import numpy as np
import pandas as pd

class SimulationEngine:
    def __init__(self, seed=None):
        if seed:
            np.random.seed(seed)

    def geometric_brownian_motion(self, initial_price, days, drift=0.0005, volatility=0.02):
        """
        Generates a realistic price walk using Geometric Brownian Motion.
        
        S_t = S_0 * exp((mu - 0.5 * sigma^2) * t + sigma * W_t)
        """
        dt = 1
        prices = [initial_price]
        
        for _ in range(days):
            shock = np.random.normal(0, 1)
            price = prices[-1] * np.exp((drift - 0.5 * volatility**2) * dt + volatility * shock * np.sqrt(dt))
            prices.append(round(price, 2))
            
        return prices[1:] # Return only the generated days

class TechnicalIndicators:
    @staticmethod
    def calculate_sma(prices, window):
        """Simple Moving Average"""
        if len(prices) < window:
            return [None] * len(prices)
        return pd.Series(prices).rolling(window=window).mean().round(2).fillna(0).tolist()

    @staticmethod
    def calculate_ema(prices, span):
        """Exponential Moving Average"""
        if len(prices) < span:
            return [None] * len(prices)
        return pd.Series(prices).ewm(span=span, adjust=False).mean().round(2).fillna(0).tolist()

    @staticmethod
    def calculate_rsi(prices, window=14):
        """Relative Strength Index"""
        if len(prices) < window:
            return [None] * len(prices)
            
        series = pd.Series(prices)
        delta = series.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()

        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi.round(2).fillna(50).tolist()

    @staticmethod
    def calculate_macd(prices, fast=12, slow=26, signal=9):
        """Moving Average Convergence Divergence"""
        if len(prices) < slow:
            return {'macd': [], 'signal': [], 'hist': []}
            
        series = pd.Series(prices)
        exp1 = series.ewm(span=fast, adjust=False).mean()
        exp2 = series.ewm(span=slow, adjust=False).mean()
        macd = exp1 - exp2
        signal_line = macd.ewm(span=signal, adjust=False).mean()
        histogram = macd - signal_line
        
        return {
            'macd': macd.round(2).fillna(0).tolist(),
            'signal': signal_line.round(2).fillna(0).tolist(),
            'hist': histogram.round(2).fillna(0).tolist()
        }
