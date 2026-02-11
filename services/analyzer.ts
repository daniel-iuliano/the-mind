import { IndicatorValues, MarketAnalysis, OHLCV, SignalBias, Timeframe } from "../types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface OrderBlockSnapshot {
  volumeNodeStrength: number;
  positioningImbalance: number;
  liquiditySkew: number;
  highVolumeZonePressure: number;
  structuralDemandSupply: number;
  netBias: number;
}

interface PredictiveContext {
  symbol: string;
  price: number;
  indicators: IndicatorValues;
  volume: number;
  prevVolume: number;
  change24h: number;
  orderBookImbalance?: number | null;
  candles?: OHLCV[];
  timeframe?: Timeframe;
}

interface MarketStateMemory {
  smoothedDelta: number;
  lastCondition: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

const MARKET_MEMORY = new Map<string, MarketStateMemory>();

const timeframeToMs = (timeframe?: Timeframe): number => {
  switch (timeframe) {
    case Timeframe.M1: return 60_000;
    case Timeframe.M5: return 5 * 60_000;
    case Timeframe.M15: return 15 * 60_000;
    case Timeframe.H1: return 60 * 60_000;
    case Timeframe.H4: return 4 * 60 * 60_000;
    case Timeframe.D1: return 24 * 60 * 60_000;
    default: return 15 * 60_000;
  }
};

const getCandlesForHours = (candles: OHLCV[] | undefined, timeframe: Timeframe | undefined, hours: number): OHLCV[] => {
  if (!candles || candles.length < 8) return [];
  const ms = timeframeToMs(timeframe);
  const points = Math.max(8, Math.round((hours * 60 * 60 * 1000) / ms));
  return candles.slice(-points);
};

const scoreStructuralPattern = (candles: OHLCV[]): { bull: number; bear: number; reasons: string[] } => {
  if (candles.length < 6) return { bull: 0, bear: 0, reasons: [] };
  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > candles[i - 1].high) higherHighs += 1;
    if (candles[i].low > candles[i - 1].low) higherLows += 1;
    if (candles[i].high < candles[i - 1].high) lowerHighs += 1;
    if (candles[i].low < candles[i - 1].low) lowerLows += 1;
  }

  const ratio = (value: number) => value / Math.max(candles.length - 1, 1);
  const bullStructure = (ratio(higherHighs) + ratio(higherLows)) / 2;
  const bearStructure = (ratio(lowerHighs) + ratio(lowerLows)) / 2;
  const reasons: string[] = [];
  if (bullStructure >= 0.62) reasons.push('STRUCTURE_HH_HL_BULL');
  if (bearStructure >= 0.62) reasons.push('STRUCTURE_LH_LL_BEAR');
  return {
    bull: clamp(bullStructure * 22, 0, 22),
    bear: clamp(bearStructure * 22, 0, 22),
    reasons,
  };
};

const scoreCandlestickPatterns = (candles: OHLCV[]): { bull: number; bear: number; reasons: string[] } => {
  if (candles.length < 3) return { bull: 0, bear: 0, reasons: [] };
  const c0 = candles[candles.length - 1];
  const c1 = candles[candles.length - 2];
  const body0 = Math.abs(c0.close - c0.open);
  const range0 = Math.max(c0.high - c0.low, c0.close * 0.0001);
  const upperWick = c0.high - Math.max(c0.open, c0.close);
  const lowerWick = Math.min(c0.open, c0.close) - c0.low;
  const body1 = Math.abs(c1.close - c1.open);
  const reasons: string[] = [];
  let bull = 0;
  let bear = 0;

  const bullishEngulfing = c1.close < c1.open && c0.close > c0.open && c0.close >= c1.open && c0.open <= c1.close;
  const bearishEngulfing = c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open;
  if (bullishEngulfing) {
    bull += 14;
    reasons.push('CANDLE_BULLISH_ENGULFING');
  }
  if (bearishEngulfing) {
    bear += 14;
    reasons.push('CANDLE_BEARISH_ENGULFING');
  }

  const doji = body0 / range0 <= 0.1;
  if (doji) reasons.push('CANDLE_DOJI_INDECISION');

  const bullishPin = lowerWick / range0 >= 0.55 && body0 / range0 <= 0.3 && c0.close >= c0.open;
  const bearishPin = upperWick / range0 >= 0.55 && body0 / range0 <= 0.3 && c0.close <= c0.open;
  if (bullishPin) {
    bull += 10;
    reasons.push('CANDLE_PINBAR_BULL');
  }
  if (bearishPin) {
    bear += 10;
    reasons.push('CANDLE_PINBAR_BEAR');
  }

  if (body0 > body1 * 1.35 && c0.close > c0.open && c1.close > c1.open) {
    bull += 6;
    reasons.push('CANDLE_BULL_MOMENTUM_BODY');
  }
  if (body0 > body1 * 1.35 && c0.close < c0.open && c1.close < c1.open) {
    bear += 6;
    reasons.push('CANDLE_BEAR_MOMENTUM_BODY');
  }

  return { bull, bear, reasons };
};

const build4hSentimentEnvelope = (ctx: PredictiveContext) => {
  const history = getCandlesForHours(ctx.candles, ctx.timeframe, 4);
  if (history.length === 0) {
    return {
      bull: 0,
      bear: 0,
      trendStrength: 0,
      volatilityRegime: 0,
      volumeConsistency: 0,
      orderFlowStrength: 0,
      structureStrength: 0,
      reasons: [] as string[],
    };
  }

  const closes = history.map((c) => c.close);
  const returns = closes.slice(1).map((close, i) => (close - closes[i]) / Math.max(closes[i], 1));
  const meanRet = returns.reduce((sum, val) => sum + val, 0) / Math.max(returns.length, 1);
  const stdRet = Math.sqrt(returns.reduce((sum, val) => sum + Math.pow(val - meanRet, 2), 0) / Math.max(returns.length, 1));
  const drift = closes.length > 1 ? (closes[closes.length - 1] - closes[0]) / Math.max(closes[0], 1) : 0;

  const avgRange = history.reduce((sum, c) => sum + (c.high - c.low) / Math.max(c.close, 1), 0) / history.length;
  const volumes = history.map((c) => c.volume).filter((v) => Number.isFinite(v) && v > 0);
  const volumeMean = volumes.reduce((sum, v) => sum + v, 0) / Math.max(volumes.length, 1);
  const volumeStd = Math.sqrt(volumes.reduce((sum, v) => sum + Math.pow(v - volumeMean, 2), 0) / Math.max(volumes.length, 1));
  const volumeCv = volumeMean > 0 ? volumeStd / volumeMean : 1;

  const candlePatterns = scoreCandlestickPatterns(history);
  const structurePatterns = scoreStructuralPattern(history);

  const trendStrength = clamp(Math.abs(drift) * 500 + Math.abs(meanRet) * 3500, 0, 100);
  const volatilityRegime = clamp((avgRange * 1400 + stdRet * 1800), 0, 100);
  const volumeConsistency = clamp((1 - clamp(volumeCv, 0, 1.3) / 1.3) * 100, 0, 100);

  const orderFlowStrength = typeof ctx.orderBookImbalance === 'number'
    ? clamp(Math.abs(ctx.orderBookImbalance) * 340, 0, 100)
    : clamp(Math.abs((ctx.indicators.ema20 - ctx.indicators.ema50) / Math.max(ctx.price, 1)) * 7800, 0, 100);

  const structureStrength = clamp((structurePatterns.bull + structurePatterns.bear) * 2.1, 0, 100);

  const direction = Math.sign(drift + meanRet * 5 + (ctx.orderBookImbalance ?? 0) * 0.2);
  const baseTrendScore = trendStrength * 0.34 + volatilityRegime * 0.13 + volumeConsistency * 0.15 + orderFlowStrength * 0.2 + structureStrength * 0.18;
  const bull = direction >= 0 ? baseTrendScore + candlePatterns.bull + structurePatterns.bull : candlePatterns.bull + structurePatterns.bull * 0.6;
  const bear = direction <= 0 ? baseTrendScore + candlePatterns.bear + structurePatterns.bear : candlePatterns.bear + structurePatterns.bear * 0.6;

  const reasons: string[] = [];
  if (trendStrength >= 58) reasons.push('MKT4H_TREND_CONFIRMED');
  if (volatilityRegime >= 42 && volatilityRegime <= 78) reasons.push('MKT4H_VOLATILITY_REGIME_STABLE');
  if (volumeConsistency >= 52) reasons.push('MKT4H_VOLUME_CONSISTENT');
  if (orderFlowStrength >= 48) reasons.push('MKT4H_ORDERFLOW_ALIGNED');
  if (structureStrength >= 50) reasons.push('MKT4H_STRUCTURE_REINFORCED');
  reasons.push(...candlePatterns.reasons, ...structurePatterns.reasons);

  return {
    bull: clamp(Math.round(bull), 0, 100),
    bear: clamp(Math.round(bear), 0, 100),
    trendStrength,
    volatilityRegime,
    volumeConsistency,
    orderFlowStrength,
    structureStrength,
    reasons,
  };
};


const calculateOrderBlockSnapshot = (ctx: PredictiveContext): OrderBlockSnapshot => {
  const { price, indicators, volume, prevVolume, change24h, orderBookImbalance } = ctx;

  const atrPct = price > 0 ? indicators.atr / price : 0;
  const trendSlope = price > 0 ? (indicators.ema20 - indicators.ema50) / price : 0;
  const macroSlope = price > 0 ? (indicators.ema50 - indicators.ema200) / price : 0;
  const bbRange = Math.max(indicators.bb.upper - indicators.bb.lower, price * 0.0025);
  const bbPosition = clamp((price - indicators.bb.lower) / bbRange, 0, 1);
  const volumeRatio = prevVolume > 0 ? volume / prevVolume : 1;

  const volumeNodeStrength = clamp(Math.abs(volumeRatio - 1) * 55 + Math.max(0, atrPct - 0.01) * 900, 0, 100);

  const positioningImbalance = typeof orderBookImbalance === 'number'
    ? clamp(Math.abs(orderBookImbalance) * 230, 0, 100)
    : clamp(Math.abs(trendSlope) * 8500, 0, 100);

  const liquiditySkew = typeof orderBookImbalance === 'number'
    ? clamp(Math.abs(orderBookImbalance) * 180 + Math.abs(change24h) * 4, 0, 100)
    : clamp(Math.abs(change24h) * 6, 0, 100);

  const highVolumeZonePressure = clamp((bbPosition < 0.3 || bbPosition > 0.7 ? 58 : 36) + volumeNodeStrength * 0.42, 0, 100);

  const structuralDemandSupply = clamp(
    Math.abs(trendSlope) * 7000 +
    Math.abs(macroSlope) * 6000 +
    (bbPosition <= 0.22 || bbPosition >= 0.78 ? 20 : 0),
    0,
    100
  );

  const orderFlowBias = typeof orderBookImbalance === 'number'
    ? clamp(orderBookImbalance * 100, -100, 100)
    : clamp((trendSlope + macroSlope) * 3000, -100, 100);

  const structureBias = clamp((0.5 - bbPosition) * 120 + (0 - change24h) * 3.5, -100, 100);
  const netBias = clamp(orderFlowBias * 0.58 + structureBias * 0.42, -100, 100);

  return {
    volumeNodeStrength,
    positioningImbalance,
    liquiditySkew,
    highVolumeZonePressure,
    structuralDemandSupply,
    netBias,
  };
};

const calculateForwardScores = (ctx: PredictiveContext) => {
  const { price, indicators, volume, prevVolume, change24h, orderBookImbalance } = ctx;

  let bull = 0;
  let bear = 0;
  const reasons: string[] = [];
  const orderBlock = calculateOrderBlockSnapshot(ctx);

  const volumeRatio = prevVolume > 0 ? volume / prevVolume : 1;
  const atrPct = price > 0 ? indicators.atr / price : 0;
  const trendSlope = price > 0 ? (indicators.ema20 - indicators.ema50) / price : 0;
  const macroSlope = price > 0 ? (indicators.ema50 - indicators.ema200) / price : 0;
  const momentum = indicators.macd.histogram;
  const bbRange = Math.max(indicators.bb.upper - indicators.bb.lower, price * 0.0025);
  const bbPosition = clamp((price - indicators.bb.lower) / bbRange, 0, 1);
  const stochCrossUp = indicators.stochRsi.k > indicators.stochRsi.d;
  const stochCrossDown = indicators.stochRsi.k < indicators.stochRsi.d;
  const envelope4h = build4hSentimentEnvelope(ctx);

  // 4h forward projection (stability-biased): extend structural drift but penalize noisy states
  const projectedBias = clamp((envelope4h.bull - envelope4h.bear) * 0.42 + (trendSlope + macroSlope) * 4200 + momentum * 1800, -28, 28);
  if (projectedBias >= 8) {
    bull += 12;
    reasons.push('FORWARD_4H_BULL_PROJECTION');
  } else if (projectedBias <= -8) {
    bear += 12;
    reasons.push('FORWARD_4H_BEAR_PROJECTION');
  } else {
    bull += 4;
    bear += 4;
    reasons.push('FORWARD_4H_NEUTRAL_PROJECTION');
  }

  // Reinforce with 4h multi-factor envelope to avoid micro-fluctuation flips.
  bull += envelope4h.bull * 0.45;
  bear += envelope4h.bear * 0.45;
  reasons.push(...envelope4h.reasons);


  // Trend continuation potential
  if (trendSlope > 0.0025 && macroSlope > 0.004) {
    bull += 20;
    reasons.push("FORWARD_TREND_CONTINUATION_BULL");
  }
  if (trendSlope < -0.0025 && macroSlope < -0.004) {
    bear += 20;
    reasons.push("FORWARD_TREND_CONTINUATION_BEAR");
  }

  // Momentum inflection (leading turn)
  if (momentum > 0 && stochCrossUp && indicators.rsi >= 40 && indicators.rsi <= 62) {
    bull += 15;
    reasons.push("FORWARD_MOMENTUM_BUILD_BULL");
  }
  if (momentum < 0 && stochCrossDown && indicators.rsi <= 60 && indicators.rsi >= 38) {
    bear += 15;
    reasons.push("FORWARD_MOMENTUM_BUILD_BEAR");
  }

  // Exhaustion-reversal setup (avoid chasing already-extended moves)
  if (change24h <= -5 && indicators.rsi < 35 && stochCrossUp && bbPosition < 0.2) {
    bull += 18;
    reasons.push("FORWARD_REVERSAL_LONG_SETUP");
  }
  if (change24h >= 5 && indicators.rsi > 65 && stochCrossDown && bbPosition > 0.8) {
    bear += 18;
    reasons.push("FORWARD_REVERSAL_SHORT_SETUP");
  }

  // Volume behavior as confirmation of what is likely next
  if (volumeRatio > 1.25) {
    if (momentum > 0 || trendSlope > 0) {
      bull += 10;
      reasons.push("FORWARD_VOLUME_SUPPORT_BULL");
    }
    if (momentum < 0 || trendSlope < 0) {
      bear += 10;
      reasons.push("FORWARD_VOLUME_SUPPORT_BEAR");
    }
  } else if (volumeRatio < 0.85 && atrPct > 0.018) {
    bull += 5;
    bear += 5;
    reasons.push("FORWARD_LOW_CONVICTION");
  }

  // Order Block core logic (must drive bias decisions)
  if (orderBlock.netBias >= 12) {
    bull += 20;
    reasons.push("ORDERBLOCK_DEMAND_DOMINANT");
  } else if (orderBlock.netBias <= -12) {
    bear += 20;
    reasons.push("ORDERBLOCK_SUPPLY_DOMINANT");
  } else {
    bull += 4;
    bear += 4;
    reasons.push("ORDERBLOCK_TRANSITION");
  }

  if (orderBlock.volumeNodeStrength >= 55) reasons.push("ORDERBLOCK_HIGH_VOLUME_ZONE");
  if (orderBlock.positioningImbalance >= 52) reasons.push("ORDERBLOCK_POSITIONING_IMBALANCE");
  if (orderBlock.liquiditySkew >= 50) reasons.push("ORDERBLOCK_LIQUIDITY_CLUSTER");

  if (typeof orderBookImbalance === 'number') {
    if (orderBookImbalance > 0.12) reasons.push("ORDERBOOK_BID_DOMINANCE");
    else if (orderBookImbalance < -0.12) reasons.push("ORDERBOOK_ASK_DOMINANCE");
    else reasons.push("ORDERBOOK_BALANCED");
  }

  // Volatility regime quality weighting
  if (atrPct < 0.006) {
    bull -= 4;
    bear -= 4;
    reasons.push("FORWARD_RANGE_COMPRESSION");
  }
  if (atrPct > 0.03) {
    bull -= 3;
    bear -= 3;
    reasons.push("FORWARD_HIGH_NOISE");
  }

  return {
    bullishStrength: clamp(Math.round(bull), 0, 100),
    bearishStrength: clamp(Math.round(bear), 0, 100),
    reasons,
    volumeRatio,
    orderBlock,
  };
};

export const scoreMarket = (
  symbol: string,
  price: number,
  indicators: IndicatorValues,
  volume: number,
  prevVolume: number,
  change24h: number,
  orderBookImbalance?: number | null,
  candles?: OHLCV[],
  timeframe?: Timeframe,
): MarketAnalysis => {
  const { bullishStrength, bearishStrength, reasons, volumeRatio } = calculateForwardScores({
    symbol,
    price,
    indicators,
    volume,
    prevVolume,
    change24h,
    orderBookImbalance,
    candles,
    timeframe,
  });

  const conditionDelta = bullishStrength - bearishStrength;
  const previous = MARKET_MEMORY.get(symbol);
  const smoothedDelta = previous
    ? previous.smoothedDelta * 0.72 + conditionDelta * 0.28
    : conditionDelta;

  const prevCondition = previous?.lastCondition ?? 'NEUTRAL';
  const bullThreshold = prevCondition === 'BEARISH' ? 15 : 11;
  const bearThreshold = prevCondition === 'BULLISH' ? -15 : -11;

  let marketCondition: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (smoothedDelta >= bullThreshold) marketCondition = 'BULLISH';
  else if (smoothedDelta <= bearThreshold) marketCondition = 'BEARISH';

  MARKET_MEMORY.set(symbol, {
    smoothedDelta,
    lastCondition: marketCondition,
  });

  const smoothedInfluence = clamp(Math.abs(smoothedDelta) * 1.8, 0, 100);
  const rawConditionStrength = marketCondition === 'BULLISH'
    ? bullishStrength
    : marketCondition === 'BEARISH'
      ? bearishStrength
      : Math.max(bullishStrength, bearishStrength);
  const conditionStrength = Math.round(clamp(rawConditionStrength * 0.72 + smoothedInfluence * 0.28, 0, 100));

  let bias = SignalBias.NEUTRAL;
  if (marketCondition === 'BULLISH') {
    if (conditionStrength >= 75) bias = SignalBias.STRONG_BUY;
    else if (conditionStrength >= 55) bias = SignalBias.BUY;
  } else if (marketCondition === 'BEARISH') {
    if (conditionStrength >= 75) bias = SignalBias.STRONG_SELL;
    else if (conditionStrength >= 55) bias = SignalBias.SELL;
  }

  const earlyLongScore = clamp(Math.round(
    bullishStrength * 0.55 +
    (indicators.stochRsi.k > indicators.stochRsi.d ? 18 : 0) +
    (indicators.rsi >= 42 && indicators.rsi <= 58 ? 12 : 0) +
    (volumeRatio > 1.2 ? 10 : 0)
  ), 0, 100);

  const earlyShortScore = clamp(Math.round(
    bearishStrength * 0.55 +
    (indicators.stochRsi.k < indicators.stochRsi.d ? 18 : 0) +
    (indicators.rsi >= 42 && indicators.rsi <= 58 ? 12 : 0) +
    (volumeRatio > 1.2 ? 10 : 0)
  ), 0, 100);

  let earlySide: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  let earlyReasons: string[] = [];
  if (earlyLongScore >= 45 && earlyLongScore >= earlyShortScore + 8) {
    earlySide = 'LONG';
    earlyReasons = reasons.filter((r) => r.includes('BULL') || r.includes('LONG')).slice(0, 3);
  } else if (earlyShortScore >= 45 && earlyShortScore >= earlyLongScore + 8) {
    earlySide = 'SHORT';
    earlyReasons = reasons.filter((r) => r.includes('BEAR') || r.includes('SHORT')).slice(0, 3);
  } else {
    earlyReasons = reasons.slice(0, 3);
  }

  return {
    symbol,
    price,
    change24h,
    volume24h: volume,
    indicators,
    marketCondition,
    conditionStrength,
    score: conditionStrength,
    bias,
    reasons: Array.from(new Set(reasons)).slice(0, 12),
    earlySignal: {
      side: earlySide,
      confidence: Math.max(earlyLongScore, earlyShortScore),
      reasons: earlyReasons,
    },
    timestamp: Date.now(),
  };
};
