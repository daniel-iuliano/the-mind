import { MarketAnalysis, SupportResistanceLevel, PredictionResult } from "../types";
import { formatPrice } from "../utils/formatters";

type MarketRegime = 'VOLATILE' | 'CALM' | 'TRENDING' | 'RANGING';

const MIN_RR = 3;

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
}

const inferOrderBlockInsights = (analysis: MarketAnalysis, levels: SupportResistanceLevel[]): OrderBlockInsights => {
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

  const volumeDistribution = clamp(Math.abs(change24h) * 5 + atrPct * 900 + (volume24h > 0 ? Math.log10(volume24h + 1) * 5 : 0), 0, 100);
  const positioningImbalance = clamp(Math.abs(trendSlope) * 8500 + Math.abs(macroSlope) * 6800, 0, 100);
  const liquidityClusters = clamp(levels.length * 10 + medianStrength * 9 + Math.abs(change24h) * 2, 0, 100);
  const highVolumeZones = clamp((bbPosition < 0.3 || bbPosition > 0.7 ? 58 : 38) + volumeDistribution * 0.45, 0, 100);
  const structuralPressure = clamp((supportWeight + resistanceWeight) * 4 + Math.abs(macroSlope) * 4000, 0, 100);

  const directionalFromLevels = clamp((supportWeight - resistanceWeight) * 6, -100, 100);
  const directionalFromPrice = clamp((0.5 - bbPosition) * 120 + (0 - change24h) * 4, -100, 100);
  const directionalFromTrend = clamp((trendSlope + macroSlope) * 2600, -100, 100);
  const netFlow = clamp(directionalFromLevels * 0.34 + directionalFromPrice * 0.38 + directionalFromTrend * 0.28, -100, 100);

  return {
    volumeDistribution,
    positioningImbalance,
    liquidityClusters,
    highVolumeZones,
    structuralPressure,
    demandBias: clamp(netFlow, 0, 100),
    supplyBias: clamp(-netFlow, 0, 100),
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

export const generatePrediction = (
  analysis: MarketAnalysis, 
  levels: SupportResistanceLevel[]
): PredictionResult => {
  const currentPrice = analysis.price;
  const atr = analysis.indicators.atr;
  let predictionBias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
  if (analysis.marketCondition === 'BULLISH') predictionBias = 'ALCISTA';
  else if (analysis.marketCondition === 'BEARISH') predictionBias = 'BAJISTA';

  const regime = detectMarketRegime(analysis);
  const orderBlockInsights = inferOrderBlockInsights(analysis, levels);

  // --- Probability Calculation (with regime weighting and statistical confidence) ---
  const directionalScore = predictionBias === 'NEUTRAL' ? 50 : analysis.score;
  const normalizedSignal = clamp((directionalScore - 50) / 50, 0, 1);
  const trendGap = Math.abs(analysis.indicators.ema20 - analysis.indicators.ema50) / Math.max(currentPrice, 1);
  const momentumStrength = Math.abs(analysis.indicators.macd.histogram) / Math.max(currentPrice * 0.01, 1e-9);
  const confidenceRaw = normalizedSignal * 0.45 + clamp(trendGap * 12, 0, 1) * 0.2 + clamp(momentumStrength * 0.2, 0, 1) * 0.15 + clamp((orderBlockInsights.volumeDistribution + orderBlockInsights.structuralPressure) / 200, 0, 1) * 0.2;

  const regimeProbabilityBias: Record<MarketRegime, number> = {
    VOLATILE: -6,
    CALM: -3,
    TRENDING: 6,
    RANGING: -1,
  };

  const orderBlockDirectionalEdge = Math.abs(orderBlockInsights.demandBias - orderBlockInsights.supplyBias) * 0.12;
  let probability = Math.round(46 + confidenceRaw * 42 + regimeProbabilityBias[regime] + orderBlockDirectionalEdge);
  probability = clamp(probability, 40, 90);

  // --- Targets & Stop Loss ---
  const candidateLevels = calculateLevelCandidates(analysis, levels);
  const { targetPrice, stopLoss, rr } = findBestRiskPlan(predictionBias, currentPrice, candidateLevels, regime);

  if ((predictionBias === 'ALCISTA' || predictionBias === 'BAJISTA') && (!targetPrice || !stopLoss)) {
    predictionBias = 'NEUTRAL';
    probability = Math.max(40, probability - 10);
  }

  // --- Risk Assessment ---
  // Volatility based risk
  const volatilityPct = (atr / currentPrice) * 100;
  let riskLevel: 'BAJO' | 'MEDIO' | 'ALTO' = 'MEDIO';
  if (volatilityPct > 2.5 || regime === 'VOLATILE') riskLevel = 'ALTO';
  if (volatilityPct < 0.7 && regime === 'CALM') riskLevel = 'BAJO';

  // --- Reasoning ---
  const reasoning = [...analysis.reasons];
  if (volatilityPct > 2) reasoning.push("HIGH_VOL_RISK");
  reasoning.push(`REGIME_${regime}`);
  reasoning.push("OB_VOLUME_DISTRIBUTION_ACTIVE");
  reasoning.push("OB_POSITIONING_IMBALANCE_VISIBLE");
  reasoning.push("OB_LIQUIDITY_CLUSTERS_NEAR_PRICE");
  reasoning.push("OB_SUPPLY_DEMAND_STRUCTURE_ACTIVE");
  if (targetPrice && stopLoss && rr >= MIN_RR) reasoning.push("RR_3_TO_1_CONFIRMED");
  if (!targetPrice || !stopLoss) reasoning.push("NO_VALID_3R_SETUP");

  const sortedSR = levels.map((level) => level.price).sort((a, b) => a - b);
  const q1 = percentile(sortedSR, 0.25);
  const q3 = percentile(sortedSR, 0.75);
  if (q1 > 0 && q3 > 0) {
    if (currentPrice < q1) reasoning.push("PRICE_IN_LOWER_VALUE_ZONE");
    if (currentPrice > q3) reasoning.push("PRICE_IN_UPPER_VALUE_ZONE");
  }

  const nowSummary = buildNowSummary(predictionBias, orderBlockInsights, regime);
  const nextScenarios = buildNextScenarios(predictionBias, orderBlockInsights);

  return {
    symbol: analysis.symbol,
    bias: predictionBias,
    entryZone: `$${formatPrice(currentPrice)}`,
    targetPrice,
    stopLoss,
    probability,
    reasoning: reasoning.slice(0, 5),
    nowSummary,
    nextScenarios,
    riskLevel,
    timestamp: Date.now()
  };
};
