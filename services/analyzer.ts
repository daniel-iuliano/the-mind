import { IndicatorValues, MarketAnalysis, SignalBias } from "../types";

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
}


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
): MarketAnalysis => {
  const { bullishStrength, bearishStrength, reasons, volumeRatio } = calculateForwardScores({
    symbol,
    price,
    indicators,
    volume,
    prevVolume,
    change24h,
    orderBookImbalance,
  });

  const conditionDelta = bullishStrength - bearishStrength;
  let marketCondition: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (conditionDelta >= 8) marketCondition = 'BULLISH';
  else if (conditionDelta <= -8) marketCondition = 'BEARISH';

  const conditionStrength = marketCondition === 'BULLISH'
    ? bullishStrength
    : marketCondition === 'BEARISH'
      ? bearishStrength
      : Math.max(bullishStrength, bearishStrength);

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
    reasons,
    earlySignal: {
      side: earlySide,
      confidence: Math.max(earlyLongScore, earlyShortScore),
      reasons: earlyReasons,
    },
    timestamp: Date.now(),
  };
};
