import { IndicatorValues, MarketAnalysis, SignalBias } from "../types";
import { SCORING } from "../constants";

export const scoreMarket = (symbol: string, price: number, indicators: IndicatorValues, volume: number, prevVolume: number, change24h: number): MarketAnalysis => {
  let score = 50; // Neutral start
  const reasons: string[] = [];
  let bias = SignalBias.NEUTRAL;

  // 1. RSI Analysis (Mean Reversion / Momentum)
  if (indicators.rsi < 30) {
    score += SCORING.RSI_WEIGHT;
    reasons.push("RSI_OVERSOLD");
  } else if (indicators.rsi > 70) {
    score -= SCORING.RSI_WEIGHT;
    reasons.push("RSI_OVERBOUGHT");
  }

  // 2. Stochastic RSI (Confirmation)
  if (indicators.stochRsi.k < 20 && indicators.stochRsi.d < 20 && indicators.stochRsi.k > indicators.stochRsi.d) {
    score += 10;
    reasons.push("STOCH_BULL_CROSS");
  } else if (indicators.stochRsi.k > 80 && indicators.stochRsi.d > 80 && indicators.stochRsi.k < indicators.stochRsi.d) {
    score -= 10;
    reasons.push("STOCH_BEAR_CROSS");
  }

  // 3. Trend Analysis (EMA)
  const isBullishTrend = price > indicators.ema50 && indicators.ema50 > indicators.ema200;
  const isBearishTrend = price < indicators.ema50 && indicators.ema50 < indicators.ema200;

  if (isBullishTrend) {
    score += SCORING.TREND_WEIGHT;
    reasons.push("EMA_ALIGN_BULL");
  } else if (isBearishTrend) {
    score -= SCORING.TREND_WEIGHT;
    reasons.push("EMA_ALIGN_BEAR");
  }

  // 4. MACD Momentum
  const histogram = indicators.macd.histogram;
  if (histogram > 0 && histogram > indicators.macd.signal) {
     score += 10;
     reasons.push("MACD_HIST_BULL");
  } else if (histogram < 0 && histogram < indicators.macd.signal) {
     score -= 10;
     reasons.push("MACD_HIST_BEAR");
  }

  // 5. Bollinger Bands (Dynamic S/R)
  if (price <= indicators.bb.lower) {
    score += 15;
    reasons.push("BB_BOUNCE_LOW");
  } else if (price >= indicators.bb.upper) {
    score -= 15;
    reasons.push("BB_REJECT_HIGH");
  }

  // 6. Volatility Filter (ATR)
  // If ATR is extremely low relative to price, volatility is dead (squeeze)
  const volatilityRatio = indicators.atr / price;
  if (volatilityRatio < 0.005) { // < 0.5% movement avg
      reasons.push("LOW_VOLATILITY");
      // Reduce strong signals in low vol environments as they are often fakeouts
      if (score > 70) score -= 10; 
      if (score < 30) score += 10;
  }

  // 7. Volume Confirmation
  if (volume > prevVolume * 1.5) {
      if (score > 60) {
          score += 5;
          reasons.push("VOL_CONFIRMATION");
      } else if (score < 40) {
          score -= 5;
          reasons.push("VOL_PRESSURE");
      }
  }

  // Normalize Score 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine Bias
  if (score >= SCORING.THRESHOLD_STRONG) bias = SignalBias.STRONG_BUY;
  else if (score >= 60) bias = SignalBias.BUY;
  else if (score <= 100 - SCORING.THRESHOLD_STRONG) bias = SignalBias.STRONG_SELL;
  else if (score <= 40) bias = SignalBias.SELL;

  return {
    symbol,
    price,
    change24h,
    volume24h: volume,
    indicators,
    score,
    bias,
    reasons,
    timestamp: Date.now()
  };
};