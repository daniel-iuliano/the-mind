import { MarketAnalysis, SupportResistanceLevel, PredictionResult, OHLCV } from "../types";
import { formatPrice } from "../utils/formatters";
import { classifyDirection, runProbabilisticEnsemble, scoreRegimePenalty, toPercentage } from "./probabilisticEngine";

type MarketRegime = 'VOLATILE' | 'CALM' | 'TRENDING' | 'RANGING';
type Direction = 'BULL' | 'BEAR' | 'NEUTRAL';

const MIN_RR = 3;
const MIN_CONFIRMATIONS = 4;
const CONFLUENCE_THRESHOLD = 66;
const DIRECTIONAL_EDGE_THRESHOLD = 10;
const EXTREME_IMBALANCE_THRESHOLD = 65;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const percentile = (sortedValues: number[], pct: number): number => {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * pct;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo];
  const weight = index - lo;
  return sortedValues[lo] * (1 - weight) + sortedValues[hi] * weight;
};

const detectMarketRegime = (analysis: MarketAnalysis): MarketRegime => {
  const { price, change24h, indicators } = analysis;
  const atrPct = price > 0 ? indicators.atr / price : 0;
  const bbWidthPct = price > 0 ? (indicators.bb.upper - indicators.bb.lower) / price : 0;
  const trendStrength = price > 0
    ? (Math.abs(indicators.ema20 - indicators.ema50) + Math.abs(indicators.ema50 - indicators.ema200)) / price
    : 0;

  if (atrPct >= 0.028 || bbWidthPct >= 0.16 || Math.abs(change24h) >= 8) return 'VOLATILE';
  if (atrPct <= 0.008 && bbWidthPct <= 0.06 && Math.abs(change24h) <= 1.2) return 'CALM';
  if (trendStrength >= 0.02 && Math.abs(change24h) >= 2) return 'TRENDING';
  return 'RANGING';
};

interface OrderBlockInsights {
  volumeDistribution: number;
  positioningImbalance: number;
  liquidityClusters: number;
  highVolumeZones: number;
  structuralPressure: number;
  demandBias: number;
  supplyBias: number;
  dominantSide: 'BULL' | 'BEAR' | 'NEUTRAL';
  dominanceStrength: number;
}

interface WeightedFactor {
  factor: string;
  score: number;
  weight: number;
  contribution: number;
  direction: Direction;
  details: string;
}

const inferOrderBlockInsights = (
  analysis: MarketAnalysis,
  levels: SupportResistanceLevel[],
  orderBookImbalance: number | null,
): OrderBlockInsights => {
  const { price, change24h, volume24h, indicators } = analysis;
  const atrPct = price > 0 ? indicators.atr / price : 0;
  const bbRange = Math.max(indicators.bb.upper - indicators.bb.lower, price * 0.0025);
  const bbPosition = clamp((price - indicators.bb.lower) / bbRange, 0, 1);
  const trendSlope = price > 0 ? (indicators.ema20 - indicators.ema50) / price : 0;
  const macroSlope = price > 0 ? (indicators.ema50 - indicators.ema200) / price : 0;

  const strengths = levels.map((l) => l.strength).sort((a, b) => a - b);
  const medianStrength = strengths.length ? strengths[Math.floor(strengths.length / 2)] : 1;
  const supportWeight = levels.filter((l) => l.type === 'support').reduce((acc, l) => acc + l.strength, 0);
  const resistanceWeight = levels.filter((l) => l.type === 'resistance').reduce((acc, l) => acc + l.strength, 0);

  const orderBookEdge = typeof orderBookImbalance === 'number' ? Math.abs(orderBookImbalance) * 70 : 8;

  const volumeDistribution = clamp(Math.abs(change24h) * 4 + atrPct * 780 + (volume24h > 0 ? Math.log10(volume24h + 1) * 7 : 0), 0, 100);
  const positioningImbalance = clamp(Math.abs(trendSlope) * 8500 + Math.abs(macroSlope) * 6800 + orderBookEdge, 0, 100);
  const liquidityClusters = clamp(levels.length * 10 + medianStrength * 9 + Math.abs(change24h) * 2.2, 0, 100);
  const highVolumeZones = clamp((bbPosition < 0.3 || bbPosition > 0.7 ? 58 : 38) + volumeDistribution * 0.45, 0, 100);
  const structuralPressure = clamp((supportWeight + resistanceWeight) * 4 + Math.abs(macroSlope) * 4000, 0, 100);

  const directionalFromLevels = clamp((supportWeight - resistanceWeight) * 6, -100, 100);
  const directionalFromPrice = clamp((0.5 - bbPosition) * 120 + (0 - change24h) * 4, -100, 100);
  const directionalFromTrend = clamp((trendSlope + macroSlope) * 2600, -100, 100);
  const directionalFromBook = typeof orderBookImbalance === 'number' ? clamp(orderBookImbalance * 100, -100, 100) : 0;
  const netFlow = clamp(
    directionalFromLevels * 0.29 + directionalFromPrice * 0.31 + directionalFromTrend * 0.24 + directionalFromBook * 0.16,
    -100,
    100,
  );

  const demandBias = clamp(netFlow, 0, 100);
  const supplyBias = clamp(-netFlow, 0, 100);
  const directionalPressure = demandBias - supplyBias;
  const dominantSide = directionalPressure > 8 ? 'BULL' : directionalPressure < -8 ? 'BEAR' : 'NEUTRAL';
  const dominanceStrength = clamp(
    Math.max(Math.abs(directionalPressure), positioningImbalance * 0.86, liquidityClusters * 0.72),
    0,
    100,
  );

  return {
    volumeDistribution,
    positioningImbalance,
    liquidityClusters,
    highVolumeZones,
    structuralPressure,
    demandBias,
    supplyBias,
    dominantSide,
    dominanceStrength,
  };
};

const buildNowSummary = (
  bias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL',
  insights: OrderBlockInsights,
  regime: MarketRegime,
): string[] => {
  const summary: string[] = [];

  if (bias === 'BAJISTA') summary.push('NOW_SHORT_BIAS_PREVAILING');
  else if (bias === 'ALCISTA') summary.push('NOW_LONG_BIAS_PREVAILING');
  else summary.push('NOW_TRANSITIONAL_BIAS');

  if (insights.volumeDistribution >= 55) summary.push('OB_VOLUME_DISTRIBUTION_ACTIVE');
  if (insights.positioningImbalance >= 52) summary.push('OB_POSITIONING_IMBALANCE_VISIBLE');
  if (insights.liquidityClusters >= 50) summary.push('OB_LIQUIDITY_CLUSTERS_NEAR_PRICE');
  if (insights.highVolumeZones >= 55) summary.push('OB_HIGH_VOLUME_ZONE_IN_CONTROL');
  if (insights.structuralPressure >= 48) summary.push('OB_SUPPLY_DEMAND_STRUCTURE_ACTIVE');

  summary.push(`REGIME_${regime}`);
  return summary.slice(0, 5);
};

const buildNextScenarios = (
  bias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL',
  insights: OrderBlockInsights,
): string[] => {
  const scenarios: string[] = [];

  if (bias === 'BAJISTA') scenarios.push('NEXT_CONTINUATION_SHORT_MOVE');
  if (bias === 'ALCISTA') scenarios.push('NEXT_CONTINUATION_LONG_MOVE');

  if (insights.demandBias >= 42) scenarios.push('NEXT_POTENTIAL_LONG_SETUP');
  if (insights.supplyBias >= 42) scenarios.push('NEXT_POTENTIAL_SHORT_SETUP');

  if (Math.abs(insights.demandBias - insights.supplyBias) <= 18 || insights.liquidityClusters >= 64) {
    scenarios.push('NEXT_REVERSAL_CONDITIONS_FORMING');
  }

  if (scenarios.length < 3) scenarios.push('NEXT_TRANSITION_STRUCTURE_WATCH');
  return scenarios.slice(0, 3);
};

const calculateLevelCandidates = (analysis: MarketAnalysis, levels: SupportResistanceLevel[]) => {
  const { price, indicators } = analysis;
  const atr = Math.max(indicators.atr, price * 0.003);
  const bbWidth = Math.max(indicators.bb.upper - indicators.bb.lower, atr);

  const statisticalLevels = [
    price + bbWidth * 0.5,
    price + bbWidth,
    price + bbWidth * 1.5,
    price - bbWidth * 0.5,
    price - bbWidth,
    price - bbWidth * 1.5,
    price + atr * 2,
    price + atr * 3,
    price - atr * 2,
    price - atr * 3,
  ];

  const structuralLevels = levels.map((level) => level.price);
  const keyZones = [
    indicators.bb.upper,
    indicators.bb.middle,
    indicators.bb.lower,
    indicators.ema20,
    indicators.ema50,
    indicators.ema200,
  ];

  const all = [...structuralLevels, ...statisticalLevels, ...keyZones]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  return all.filter((value, idx) => idx === 0 || Math.abs(value - all[idx - 1]) / Math.max(value, 1) > 0.001);
};

const evaluateCandlesAndStructure = (candles: OHLCV[]) => {
  if (candles.length < 6) return { bull: 0, bear: 0, reasons: [] as string[] };

  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  const body = Math.abs(latest.close - latest.open);
  const range = Math.max(latest.high - latest.low, latest.close * 0.0001);
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;

  const reasons: string[] = [];
  let bull = 0;
  let bear = 0;

  const bullishEngulfing = prev.close < prev.open && latest.close > latest.open && latest.close >= prev.open && latest.open <= prev.close;
  const bearishEngulfing = prev.close > prev.open && latest.close < latest.open && latest.open >= prev.close && latest.close <= prev.open;
  if (bullishEngulfing) { bull += 14; reasons.push('CANDLE_BULLISH_ENGULFING'); }
  if (bearishEngulfing) { bear += 14; reasons.push('CANDLE_BEARISH_ENGULFING'); }

  const doji = body / range <= 0.1;
  if (doji) reasons.push('CANDLE_DOJI_INDECISION');

  if (lowerWick / range >= 0.55 && body / range <= 0.3 && latest.close >= latest.open) {
    bull += 10;
    reasons.push('CANDLE_PINBAR_BULL');
  }
  if (upperWick / range >= 0.55 && body / range <= 0.3 && latest.close <= latest.open) {
    bear += 10;
    reasons.push('CANDLE_PINBAR_BEAR');
  }

  const insideBar = latest.high <= prev.high && latest.low >= prev.low;
  if (insideBar) reasons.push('CANDLE_INSIDE_BAR_COMPRESSION');

  const bullContinuation = latest.close > prev.high && prev.close > prev.open;
  const bearContinuation = latest.close < prev.low && prev.close < prev.open;
  if (bullContinuation) { bull += 8; reasons.push('CANDLE_CONTINUATION_BULL'); }
  if (bearContinuation) { bear += 8; reasons.push('CANDLE_CONTINUATION_BEAR'); }

  const highs = candles.slice(-14).map((c) => c.high);
  const lows = candles.slice(-14).map((c) => c.low);
  const hh = highs.filter((value, idx) => idx > 0 && value > highs[idx - 1]).length;
  const hl = lows.filter((value, idx) => idx > 0 && value > lows[idx - 1]).length;
  const lh = highs.filter((value, idx) => idx > 0 && value < highs[idx - 1]).length;
  const ll = lows.filter((value, idx) => idx > 0 && value < lows[idx - 1]).length;

  const bullStructure = (hh + hl) / Math.max((highs.length - 1) * 2, 1);
  const bearStructure = (lh + ll) / Math.max((highs.length - 1) * 2, 1);
  if (bullStructure >= 0.58) { bull += 12; reasons.push('STRUCTURE_HH_HL_BULL'); }
  if (bearStructure >= 0.58) { bear += 12; reasons.push('STRUCTURE_LH_LL_BEAR'); }

  const highestRecent = Math.max(...candles.slice(-10).map((c) => c.high));
  const lowestRecent = Math.min(...candles.slice(-10).map((c) => c.low));
  if (latest.close > highestRecent * 0.9995 && prev.close <= highestRecent * 0.9985) {
    bull += 10;
    reasons.push('STRUCTURE_BREAK_OF_STRUCTURE_BULL');
  }
  if (latest.close < lowestRecent * 1.0005 && prev.close >= lowestRecent * 1.0015) {
    bear += 10;
    reasons.push('STRUCTURE_BREAK_OF_STRUCTURE_BEAR');
  }

  const chochBull = prev2.low < prev.low && latest.low > prev.low && latest.close > prev.close;
  const chochBear = prev2.high > prev.high && latest.high < prev.high && latest.close < prev.close;
  if (chochBull) { bull += 6; reasons.push('STRUCTURE_CHOCH_BULL'); }
  if (chochBear) { bear += 6; reasons.push('STRUCTURE_CHOCH_BEAR'); }

  return { bull, bear, reasons };
};

const buildVolumeProfileSignal = (candles: OHLCV[]) => {
  if (candles.length < 12) return { score: 50, direction: 'NEUTRAL' as Direction, details: 'Insufficient candles for profile', reasons: [] as string[] };

  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const bins = 8;
  const step = Math.max((max - min) / bins, Math.max(max, 1) * 0.0005);
  const volumeBins = new Array(bins).fill(0);

  candles.forEach((c) => {
    const idx = clamp(Math.floor((c.close - min) / step), 0, bins - 1);
    volumeBins[idx] += c.volume;
  });

  const totalVolume = volumeBins.reduce((acc, v) => acc + v, 0);
  if (totalVolume <= 0) return { score: 50, direction: 'NEUTRAL' as Direction, details: 'No volume registered', reasons: [] as string[] };

  const pocIndex = volumeBins.reduce((best, volume, idx) => (volume > volumeBins[best] ? idx : best), 0);
  const pocPrice = min + step * (pocIndex + 0.5);
  const latest = candles[candles.length - 1].close;
  const distance = (latest - pocPrice) / Math.max(latest, 1);

  if (distance >= 0.006) {
    return {
      score: clamp(50 + distance * 3800, 50, 100),
      direction: 'BULL' as Direction,
      details: `Price above POC (${formatPrice(pocPrice)}) with supportive volume node`,
      reasons: ['VOLUME_PROFILE_BULL_SUPPORT'],
    };
  }

  if (distance <= -0.006) {
    return {
      score: clamp(50 + Math.abs(distance) * 3800, 50, 100),
      direction: 'BEAR' as Direction,
      details: `Price below POC (${formatPrice(pocPrice)}) with overhead supply node`,
      reasons: ['VOLUME_PROFILE_BEAR_PRESSURE'],
    };
  }

  return {
    score: 52,
    direction: 'NEUTRAL' as Direction,
    details: `Price near POC (${formatPrice(pocPrice)}) in balanced distribution`,
    reasons: ['VOLUME_PROFILE_BALANCED'],
  };
};

const buildVolatilitySignal = (analysis: MarketAnalysis, candles: OHLCV[], regime: MarketRegime) => {
  if (candles.length < 12 || analysis.price <= 0) {
    return { score: 50, direction: 'NEUTRAL' as Direction, details: 'Insufficient volatility sample', reasons: [] as string[] };
  }

  const returns = candles.slice(1).map((c, i) => (c.close - candles[i].close) / Math.max(candles[i].close, 1e-9));
  const mean = returns.reduce((acc, r) => acc + r, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(returns.length - 1, 1);
  const sigma = Math.sqrt(variance);
  const atrPct = analysis.indicators.atr / analysis.price;

  const stableDirectional = sigma < 0.012 && atrPct < 0.024 && regime !== 'VOLATILE';
  const noisy = sigma > 0.02 || atrPct > 0.03 || regime === 'VOLATILE';

  if (stableDirectional) {
    return {
      score: clamp(62 + (0.02 - sigma) * 700, 55, 90),
      direction: 'NEUTRAL' as Direction,
      details: `Stable volatility regime (σ=${(sigma * 100).toFixed(2)}%, ATR=${(atrPct * 100).toFixed(2)}%)`,
      reasons: ['VOLATILITY_REGIME_STABLE'],
    };
  }

  if (noisy) {
    return {
      score: clamp(40 - (sigma - 0.02) * 500, 15, 48),
      direction: 'NEUTRAL' as Direction,
      details: `High-noise regime (σ=${(sigma * 100).toFixed(2)}%, ATR=${(atrPct * 100).toFixed(2)}%)`,
      reasons: ['VOLATILITY_REGIME_NOISY'],
    };
  }

  return {
    score: 56,
    direction: 'NEUTRAL' as Direction,
    details: `Transitional volatility regime (σ=${(sigma * 100).toFixed(2)}%, ATR=${(atrPct * 100).toFixed(2)}%)`,
    reasons: ['VOLATILITY_REGIME_TRANSITION'],
  };
};

const buildMomentumSignal = (analysis: MarketAnalysis) => {
  const { indicators, price } = analysis;
  const rsiEdge = clamp((indicators.rsi - 50) / 18, -1, 1);
  const stochEdge = clamp((indicators.stochRsi.k - indicators.stochRsi.d) / 35, -1, 1);
  const macdEdge = clamp(indicators.macd.histogram / Math.max(price * 0.01, 1e-9), -1, 1);
  const composite = rsiEdge * 0.35 + stochEdge * 0.25 + macdEdge * 0.4;

  if (composite >= 0.2) {
    return {
      score: clamp(50 + composite * 42, 50, 95),
      direction: 'BULL' as Direction,
      details: `RSI/Stoch/MACD aligned bullish (${composite.toFixed(2)})`,
      reasons: ['MOMENTUM_STACK_BULLISH'],
    };
  }

  if (composite <= -0.2) {
    return {
      score: clamp(50 + Math.abs(composite) * 42, 50, 95),
      direction: 'BEAR' as Direction,
      details: `RSI/Stoch/MACD aligned bearish (${composite.toFixed(2)})`,
      reasons: ['MOMENTUM_STACK_BEARISH'],
    };
  }

  return {
    score: 52,
    direction: 'NEUTRAL' as Direction,
    details: `Momentum mixed (${composite.toFixed(2)})`,
    reasons: ['MOMENTUM_MIXED'],
  };
};

const findBestRiskPlan = (
  bias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL',
  price: number,
  candidates: number[],
  regime: MarketRegime,
) => {
  if (bias === 'NEUTRAL') return { targetPrice: null, stopLoss: null, rr: 0 };

  const isLong = bias === 'ALCISTA';
  const targetCandidates = candidates
    .filter((level) => (isLong ? level > price : level < price))
    .sort((a, b) => (isLong ? a - b : b - a));
  const stopCandidates = candidates
    .filter((level) => (isLong ? level < price : level > price))
    .sort((a, b) => (isLong ? b - a : a - b));

  const riskMultiplierByRegime: Record<MarketRegime, number> = {
    VOLATILE: 0.75,
    TRENDING: 1,
    RANGING: 0.85,
    CALM: 0.65,
  };

  const maxRiskPct = 0.04 * riskMultiplierByRegime[regime];
  const plans: Array<{ targetPrice: number; stopLoss: number; rr: number; targetDistance: number }> = [];

  for (const stopLoss of stopCandidates) {
    const riskDistance = Math.abs(price - stopLoss);
    if (riskDistance <= 0) continue;
    if (price > 0 && riskDistance / price > maxRiskPct) continue;

    for (const targetPrice of targetCandidates) {
      const rewardDistance = Math.abs(targetPrice - price);
      if (rewardDistance <= 0) continue;
      const rr = rewardDistance / riskDistance;
      if (rr < MIN_RR) continue;
      plans.push({ targetPrice, stopLoss, rr, targetDistance: rewardDistance });
    }
  }

  if (plans.length === 0) return { targetPrice: null, stopLoss: null, rr: 0 };

  plans.sort((a, b) => {
    if (Math.abs(a.rr - b.rr) > 0.15) return b.rr - a.rr;
    return a.targetDistance - b.targetDistance;
  });

  return plans[0];
};

const directionToBias = (direction: Direction): 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' => {
  if (direction === 'BULL') return 'ALCISTA';
  if (direction === 'BEAR') return 'BAJISTA';
  return 'NEUTRAL';
};

export const generatePrediction = (
  analysis: MarketAnalysis,
  levels: SupportResistanceLevel[],
  candles: OHLCV[] = [],
  orderBookImbalance: number | null = null,
): PredictionResult => {
  const currentPrice = analysis.price;
  const atr = analysis.indicators.atr;
  const regime = detectMarketRegime(analysis);

  const structuralBaseDirection: Direction =
    analysis.marketCondition === 'BULLISH' ? 'BULL' : analysis.marketCondition === 'BEARISH' ? 'BEAR' : 'NEUTRAL';

  const candleStructure = evaluateCandlesAndStructure(candles);
  const orderBlockInsights = inferOrderBlockInsights(analysis, levels, orderBookImbalance);
  const volumeProfileSignal = buildVolumeProfileSignal(candles);
  const volatilitySignal = buildVolatilitySignal(analysis, candles, regime);
  const momentumSignal = buildMomentumSignal(analysis);

  const trendGap = Math.abs(analysis.indicators.ema20 - analysis.indicators.ema50) / Math.max(currentPrice, 1);
  const trendSignal = {
    score: clamp(50 + trendGap * 2000, 45, 95),
    direction: structuralBaseDirection,
    details: `EMA trend displacement ${(trendGap * 100).toFixed(2)}% with condition ${analysis.marketCondition}`,
    reasons: ['TREND_ALIGNMENT_MATRIX'],
  };

  const orderBlockDirectionalEdge = orderBlockInsights.demandBias - orderBlockInsights.supplyBias;
  const orderBlockSignal = {
    score: clamp(54 + Math.abs(orderBlockDirectionalEdge) * 0.6 + orderBlockInsights.dominanceStrength * 0.12, 48, 98),
    direction: orderBlockDirectionalEdge > 6 ? 'BULL' as Direction : orderBlockDirectionalEdge < -6 ? 'BEAR' as Direction : 'NEUTRAL' as Direction,
    details: `Order block pressure D:${orderBlockInsights.demandBias.toFixed(1)} / S:${orderBlockInsights.supplyBias.toFixed(1)} dom:${orderBlockInsights.dominanceStrength.toFixed(1)}`,
    reasons: [
      'OB_VOLUME_DISTRIBUTION_ACTIVE',
      'OB_POSITIONING_IMBALANCE_VISIBLE',
      'OB_LIQUIDITY_CLUSTERS_NEAR_PRICE',
      'OB_SUPPLY_DEMAND_STRUCTURE_ACTIVE',
      'OB_DOMINANCE_PRIORITY',
    ],
  };

  const candleDirection = candleStructure.bull > candleStructure.bear ? 'BULL' : candleStructure.bear > candleStructure.bull ? 'BEAR' : 'NEUTRAL';
  const candleSignal = {
    score: clamp(50 + Math.abs(candleStructure.bull - candleStructure.bear) * 1.4, 45, 95),
    direction: candleDirection as Direction,
    details: `Pattern score bull:${candleStructure.bull} bear:${candleStructure.bear}`,
    reasons: candleStructure.reasons,
  };

  const factors: WeightedFactor[] = [
    { factor: 'trend_structure', score: trendSignal.score, weight: 0.14, contribution: 0, direction: trendSignal.direction, details: trendSignal.details },
    { factor: 'candlestick_patterns', score: candleSignal.score, weight: 0.1, contribution: 0, direction: candleSignal.direction, details: candleSignal.details },
    { factor: 'momentum_confirmation', score: momentumSignal.score, weight: 0.1, contribution: 0, direction: momentumSignal.direction, details: momentumSignal.details },
    { factor: 'order_block_logic', score: orderBlockSignal.score, weight: 0.34, contribution: 0, direction: orderBlockSignal.direction, details: orderBlockSignal.details },
    { factor: 'volume_profile', score: volumeProfileSignal.score, weight: 0.12, contribution: 0, direction: volumeProfileSignal.direction, details: volumeProfileSignal.details },
    { factor: 'volatility_regime', score: volatilitySignal.score, weight: 0.08, contribution: 0, direction: volatilitySignal.direction, details: volatilitySignal.details },
    {
      factor: 'statistical_confidence',
      score: clamp(45 + Math.abs(analysis.score - 50) * 0.9 + Math.abs(orderBookImbalance ?? 0) * 30, 40, 95),
      weight: 0.12,
      contribution: 0,
      direction: structuralBaseDirection,
      details: `Weighted score:${Math.round(analysis.score)} orderbook:${(orderBookImbalance ?? 0).toFixed(3)}`,
    },
  ];

  factors.forEach((factor) => {
    factor.contribution = Number((factor.score * factor.weight).toFixed(2));
  });

  const directionalBull = factors.reduce((acc, f) => acc + (f.direction === 'BULL' ? f.contribution : 0), 0);
  const directionalBear = factors.reduce((acc, f) => acc + (f.direction === 'BEAR' ? f.contribution : 0), 0);
  const directionalEdge = directionalBull - directionalBear;
  const confluenceScore = Math.round(factors.reduce((acc, f) => acc + f.contribution, 0));

  const confirmations = factors.filter((f) => {
    if (directionalEdge >= 0) return f.direction === 'BULL' && f.score >= 56;
    return f.direction === 'BEAR' && f.score >= 56;
  }).length;

  const initialEnsemble = runProbabilisticEnsemble({
    factors: factors.map((factor) => ({
      name: factor.factor,
      score: factor.score,
      weight: factor.weight,
      direction: factor.direction,
    })),
    regimePenalty: scoreRegimePenalty(regime),
  });

  let finalDirection: Direction = classifyDirection(initialEnsemble, DIRECTIONAL_EDGE_THRESHOLD / 100);

  const extremeLiquidityImbalance = orderBlockInsights.dominanceStrength >= EXTREME_IMBALANCE_THRESHOLD;
  const contradictionDetected =
    finalDirection !== 'NEUTRAL' &&
    orderBlockInsights.dominantSide !== 'NEUTRAL' &&
    finalDirection !== orderBlockInsights.dominantSide &&
    extremeLiquidityImbalance;

  if (contradictionDetected) {
    finalDirection = 'NEUTRAL';
  }

  const probabilisticOutput = runProbabilisticEnsemble({
    factors: factors.map((factor) => ({
      name: factor.factor,
      score: factor.score,
      weight: factor.weight,
      direction: factor.direction,
    })),
    regimePenalty: scoreRegimePenalty(regime),
    contradictionPenalty: contradictionDetected ? 0.35 : 0,
  });

  const candidateLevels = calculateLevelCandidates(analysis, levels);
  let predictionBias = directionToBias(finalDirection);
  const { targetPrice, stopLoss, rr } = findBestRiskPlan(predictionBias, currentPrice, candidateLevels, regime);

  const minConfirmations = contradictionDetected ? MIN_CONFIRMATIONS + 2 : MIN_CONFIRMATIONS;
  const minConfluenceThreshold = contradictionDetected ? CONFLUENCE_THRESHOLD + 8 : CONFLUENCE_THRESHOLD;
  const orderBlockDirectionAligned =
    finalDirection === 'NEUTRAL'
      ? false
      : orderBlockInsights.dominantSide === 'NEUTRAL'
        ? orderBlockSignal.direction === finalDirection
        : orderBlockInsights.dominantSide === finalDirection;

  const validationPassed =
    finalDirection !== 'NEUTRAL' &&
    confirmations >= minConfirmations &&
    confluenceScore >= minConfluenceThreshold &&
    orderBlockDirectionAligned &&
    !!targetPrice &&
    !!stopLoss &&
    rr >= MIN_RR;

  if (!validationPassed) {
    predictionBias = 'NEUTRAL';
  }

  let probability = toPercentage(Math.max(probabilisticOutput.bullProbability, probabilisticOutput.bearProbability));
  probability = Math.round(clamp(probability * 0.7 + confluenceScore * 0.22 + orderBlockSignal.score * 0.08, 35, 96));
  if (!validationPassed) probability = Math.max(35, probability - 16);
  if (contradictionDetected) probability = Math.max(30, probability - 20);

  const volatilityPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  let riskLevel: 'BAJO' | 'MEDIO' | 'ALTO' = 'MEDIO';
  if (volatilityPct > 2.5 || regime === 'VOLATILE') riskLevel = 'ALTO';
  if (volatilityPct < 0.7 && regime === 'CALM') riskLevel = 'BAJO';

  const reasoning = [
    ...analysis.reasons,
    ...candleSignal.reasons,
    ...momentumSignal.reasons,
    ...volumeProfileSignal.reasons,
    ...volatilitySignal.reasons,
    ...orderBlockSignal.reasons,
  ];

  if (typeof orderBookImbalance === 'number') {
    if (orderBookImbalance >= 0.1) reasoning.push('ORDERBOOK_BID_DOMINANCE');
    else if (orderBookImbalance <= -0.1) reasoning.push('ORDERBOOK_ASK_DOMINANCE');
    else reasoning.push('ORDERBOOK_BALANCED');

    if (orderBookImbalance >= 0.65) reasoning.push('ORDERBOOK_EXTREME_LONG_IMBALANCE');
    if (orderBookImbalance <= -0.65) reasoning.push('ORDERBOOK_EXTREME_SHORT_IMBALANCE');
  }

  if (contradictionDetected) reasoning.push('LIQUIDITY_STRUCTURE_CONTRADICTION');
  if (!orderBlockDirectionAligned && finalDirection !== 'NEUTRAL') reasoning.push('ORDERBLOCK_DIRECTION_MISMATCH');

  reasoning.push(`REGIME_${regime}`);
  if (validationPassed) reasoning.push('PREDICTION_VALIDATION_PASSED');
  else reasoning.push('PREDICTION_VALIDATION_FAILED');

  const sortedSR = levels.map((level) => level.price).sort((a, b) => a - b);
  const q1 = percentile(sortedSR, 0.25);
  const q3 = percentile(sortedSR, 0.75);
  if (q1 > 0 && q3 > 0) {
    if (currentPrice < q1) reasoning.push('PRICE_IN_LOWER_VALUE_ZONE');
    if (currentPrice > q3) reasoning.push('PRICE_IN_UPPER_VALUE_ZONE');
  }

  const nowSummary = buildNowSummary(predictionBias, orderBlockInsights, regime);
  const nextScenarios = buildNextScenarios(predictionBias, orderBlockInsights);

  return {
    symbol: analysis.symbol,
    bias: predictionBias,
    entryZone: `$${formatPrice(currentPrice)}`,
    targetPrice: predictionBias === 'NEUTRAL' ? null : targetPrice,
    stopLoss: predictionBias === 'NEUTRAL' ? null : stopLoss,
    probability,
    reasoning: Array.from(new Set(reasoning)).slice(0, 8),
    nowSummary,
    nextScenarios,
    riskLevel,
    validation: {
      passed: validationPassed,
      confluenceScore,
      confirmations,
      threshold: CONFLUENCE_THRESHOLD,
    },
    modelDiagnostics: {
      bullProbability: toPercentage(probabilisticOutput.bullProbability),
      bearProbability: toPercentage(probabilisticOutput.bearProbability),
      neutralProbability: toPercentage(probabilisticOutput.neutralProbability),
      uncertainty: toPercentage(probabilisticOutput.uncertainty),
      ensembleConfidence: Math.round(probabilisticOutput.confidence),
      directionalEdge: Number(probabilisticOutput.directionalEdge.toFixed(3)),
    },
    auditTrail: factors,
    timestamp: Date.now(),
  };
};
