import { IndicatorValues, MarketAnalysis, SignalBias } from "../types";
import { SCORING } from "../constants";

export const scoreMarket = (symbol: string, price: number, indicators: IndicatorValues, volume: number, prevVolume: number, change24h: number): MarketAnalysis => {
  let score = 50; // Neutral start
  const reasons: string[] = [];
  let bias = SignalBias.NEUTRAL;
  let bullSignals = 0;
  let bearSignals = 0;

  const addBullSignal = (weight: number, reason: string) => {
    score += weight;
    reasons.push(reason);
    bullSignals += 1;
  };

  const addBearSignal = (weight: number, reason: string) => {
    score -= weight;
    reasons.push(reason);
    bearSignals += 1;
  };

  // 1. RSI Analysis (Mean Reversion / Momentum)
  if (indicators.rsi < 30) {
    addBullSignal(SCORING.RSI_WEIGHT, "RSI_OVERSOLD");
  } else if (indicators.rsi > 70) {
    addBearSignal(SCORING.RSI_WEIGHT, "RSI_OVERBOUGHT");
  }

  // 2. Stochastic RSI (Confirmation)
  if (indicators.stochRsi.k < 20 && indicators.stochRsi.d < 20 && indicators.stochRsi.k > indicators.stochRsi.d) {
    addBullSignal(10, "STOCH_BULL_CROSS");
  } else if (indicators.stochRsi.k > 80 && indicators.stochRsi.d > 80 && indicators.stochRsi.k < indicators.stochRsi.d) {
    addBearSignal(10, "STOCH_BEAR_CROSS");
  }

  // 3. Trend Analysis (EMA)
  const isBullishTrend = price > indicators.ema50 && indicators.ema50 > indicators.ema200;
  const isBearishTrend = price < indicators.ema50 && indicators.ema50 < indicators.ema200;

  if (isBullishTrend) {
    addBullSignal(SCORING.TREND_WEIGHT, "EMA_ALIGN_BULL");
  } else if (isBearishTrend) {
    addBearSignal(SCORING.TREND_WEIGHT, "EMA_ALIGN_BEAR");
  }

  // 4. MACD Momentum
  const histogram = indicators.macd.histogram;
  if (histogram > 0 && histogram > indicators.macd.signal) {
     addBullSignal(10, "MACD_HIST_BULL");
  } else if (histogram < 0 && histogram < indicators.macd.signal) {
     addBearSignal(10, "MACD_HIST_BEAR");
  }

  // 5. Bollinger Bands (Dynamic S/R)
  if (price <= indicators.bb.lower) {
    addBullSignal(15, "BB_BOUNCE_LOW");
  } else if (price >= indicators.bb.upper) {
    addBearSignal(15, "BB_REJECT_HIGH");
  }

  // 6. Price Momentum (24h change)
  const bullishMomentum = change24h > 2;
  const bearishMomentum = change24h < -2;
  if (bullishMomentum) {
    addBullSignal(5, "PRICE_MOMENTUM_BULL");
  } else if (bearishMomentum) {
    addBearSignal(5, "PRICE_MOMENTUM_BEAR");
  }

  // 7. Trap Risk (Trend vs Momentum)
  if (isBullishTrend && indicators.rsi > 70 && histogram < 0) {
    addBearSignal(15, "BULL_TRAP_RISK");
  } else if (isBearishTrend && indicators.rsi < 30 && histogram > 0) {
    addBullSignal(15, "BEAR_TRAP_RISK");
  }

  // 8. Volatility Filter (ATR)
  // If ATR is extremely low relative to price, volatility is dead (squeeze)
  const volatilityRatio = indicators.atr / price;
  if (volatilityRatio < 0.005) { // < 0.5% movement avg
      reasons.push("LOW_VOLATILITY");
      // Reduce strong signals in low vol environments as they are often fakeouts
      if (score > 70) score -= 10; 
      if (score < 30) score += 10;
  }

  // 9. Volume Confirmation
  if (volume > prevVolume * 1.5) {
      if (isBullishTrend || bullishMomentum) {
          addBullSignal(5, "VOL_CONFIRMATION");
      } else if (isBearishTrend || bearishMomentum) {
          addBearSignal(5, "VOL_PRESSURE");
      } else {
          reasons.push("VOL_SPIKE_UNCERTAIN");
      }
  }

  // 10. Indicator Consensus
  const totalSignals = bullSignals + bearSignals;
  if (totalSignals >= 4 && bullSignals > 0 && bearSignals > 0) {
    const conflictPenalty = 10;
    score = score > 50 ? score - conflictPenalty : score + conflictPenalty;
    reasons.push("SIGNAL_CONFLICT");
  } else if (bullSignals >= 3 && bearSignals === 0) {
    addBullSignal(5, "SIGNAL_STACK_BULL");
  } else if (bearSignals >= 3 && bullSignals === 0) {
    addBearSignal(5, "SIGNAL_STACK_BEAR");
  }

  // Normalize Score 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine Bias
  if (score >= SCORING.THRESHOLD_STRONG) bias = SignalBias.STRONG_BUY;
  else if (score >= 60) bias = SignalBias.BUY;
  else if (score <= 100 - SCORING.THRESHOLD_STRONG) bias = SignalBias.STRONG_SELL;
  else if (score <= 40) bias = SignalBias.SELL;

  // Early Signal Detection (Possible Shorts/Longs)
  const earlyLongReasons: string[] = [];
  const earlyShortReasons: string[] = [];
  let earlyLongScore = 0;
  let earlyShortScore = 0;

  if (price > indicators.ema20 && indicators.ema20 > indicators.ema50) {
    earlyLongScore += 20;
    earlyLongReasons.push("EARLY_EMA_BULL");
  } else if (price < indicators.ema20 && indicators.ema20 < indicators.ema50) {
    earlyShortScore += 20;
    earlyShortReasons.push("EARLY_EMA_BEAR");
  }

  if (indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0) {
    earlyLongScore += 20;
    earlyLongReasons.push("EARLY_MACD_BULL");
  } else if (indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0) {
    earlyShortScore += 20;
    earlyShortReasons.push("EARLY_MACD_BEAR");
  }

  if (indicators.stochRsi.k > indicators.stochRsi.d && indicators.stochRsi.k < 30) {
    earlyLongScore += 15;
    earlyLongReasons.push("EARLY_STOCH_BULL");
  } else if (indicators.stochRsi.k < indicators.stochRsi.d && indicators.stochRsi.k > 70) {
    earlyShortScore += 15;
    earlyShortReasons.push("EARLY_STOCH_BEAR");
  }

  if (indicators.rsi > 52 && indicators.rsi < 60) {
    earlyLongScore += 10;
    earlyLongReasons.push("EARLY_RSI_BULL");
  } else if (indicators.rsi < 48 && indicators.rsi > 40) {
    earlyShortScore += 10;
    earlyShortReasons.push("EARLY_RSI_BEAR");
  }

  if (price > indicators.bb.middle) {
    earlyLongScore += 10;
    earlyLongReasons.push("EARLY_BB_BULL");
  } else if (price < indicators.bb.middle) {
    earlyShortScore += 10;
    earlyShortReasons.push("EARLY_BB_BEAR");
  }

  const maxEarlyScore = Math.max(earlyLongScore, earlyShortScore);
  const minEarlyScore = 35;
  let earlySide: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let earlyReasons: string[] = [];

  if (earlyLongScore >= minEarlyScore && earlyLongScore >= earlyShortScore + 10) {
    earlySide = 'LONG';
    earlyReasons = earlyLongReasons;
  } else if (earlyShortScore >= minEarlyScore && earlyShortScore >= earlyLongScore + 10) {
    earlySide = 'SHORT';
    earlyReasons = earlyShortReasons;
  } else if (maxEarlyScore >= minEarlyScore) {
    earlyReasons = earlyLongScore >= earlyShortScore ? earlyLongReasons : earlyShortReasons;
    earlyReasons.push("EARLY_SIGNAL_CONFLICT");
  }

  let earlyConfidence = Math.min(95, Math.round((maxEarlyScore / 75) * 100));
  if (volatilityRatio < 0.005 && earlyConfidence > 0) {
    earlyConfidence = Math.max(0, earlyConfidence - 10);
    if (earlySide !== 'NEUTRAL') {
      earlyReasons.push("EARLY_LOW_VOL");
    }
  }

  return {
    symbol,
    price,
    change24h,
    volume24h: volume,
    indicators,
    score,
    bias,
    reasons,
    earlySignal: {
      side: earlySide,
      confidence: earlyConfidence,
      reasons: earlyReasons.slice(0, 3)
    },
    timestamp: Date.now()
  };
};
