import { IndicatorValues, MarketAnalysis, OHLCV, SignalBias, Timeframe } from "../types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface OrderBlockSnapshot {
  volumeNodeStrength: number;
  positioningImbalance: number;
  liquiditySkew: number;
  highVolumeZonePressure: number;
  structuralDemandSupply: number;
  netBias: number;
  dominantSide: 'LONG' | 'SHORT' | 'BALANCED';
  dominanceStrength: number;
  contradictionRisk: number;
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

interface PerfectTradeMemory {
  robustScore: number;
  confluenceScore: number;
  holdMs: number;
  lastTs: number;
  active: boolean;
}

const MARKET_MEMORY = new Map<string, MarketStateMemory>();
const PERFECT_TRADE_MEMORY = new Map<string, PerfectTradeMemory>();
const PERFECT_TRADE_STORAGE_KEY = 'quantmind_perfect_trade_memory_v1';
const DAILY_RESET_STORAGE_KEY = 'quantmind_daily_score_reset_utc_v1';
const DAILY_RESET_HOUR_UTC = 21;
let perfectMemoryHydrated = false;

const buildUtcMinuteKey = (ts: number): string => {
  const date = new Date(ts);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const getStorage = (): Storage | null => {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return null;
  return globalThis.localStorage;
};

const hydratePerfectMemory = () => {
  if (perfectMemoryHydrated) return;
  perfectMemoryHydrated = true;
  const storage = getStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(PERFECT_TRADE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PerfectTradeMemory>;
    Object.entries(parsed).forEach(([symbol, state]) => {
      if (!state || typeof state.robustScore !== 'number') return;
      PERFECT_TRADE_MEMORY.set(symbol, {
        robustScore: clamp(state.robustScore, -100, 100),
        confluenceScore: clamp(state.confluenceScore ?? 0, 0, 100),
        holdMs: Math.max(0, state.holdMs ?? 0),
        lastTs: state.lastTs ?? Date.now(),
        active: Boolean(state.active),
      });
    });
  } catch {
    // ignore persistence corruption
  }
};

const persistPerfectMemory = () => {
  const storage = getStorage();
  if (!storage) return;
  try {
    const payload = Array.from(PERFECT_TRADE_MEMORY.entries()).reduce<Record<string, PerfectTradeMemory>>((acc, [symbol, state]) => {
      acc[symbol] = state;
      return acc;
    }, {});
    storage.setItem(PERFECT_TRADE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
};

const resetDailyScoringIfNeeded = (nowTs: number) => {
  const now = new Date(nowTs);
  if (now.getUTCHours() !== DAILY_RESET_HOUR_UTC || now.getUTCMinutes() !== 0) return;

  const resetMinuteKey = buildUtcMinuteKey(nowTs);
  const storage = getStorage();
  const lastResetMinuteKey = storage?.getItem(DAILY_RESET_STORAGE_KEY) ?? null;
  if (lastResetMinuteKey === resetMinuteKey) return;

  MARKET_MEMORY.clear();
  PERFECT_TRADE_MEMORY.clear();
  persistPerfectMemory();

  if (!storage) return;
  try {
    storage.setItem(DAILY_RESET_STORAGE_KEY, resetMinuteKey);
  } catch {
    // ignore quota errors
  }
};

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
  const dominantSide = netBias >= 18 ? 'LONG' : netBias <= -18 ? 'SHORT' : 'BALANCED';
  const dominanceStrength = clamp(Math.max(Math.abs(netBias), positioningImbalance * 0.8, liquiditySkew * 0.72), 0, 100);
  const contradictionRisk = clamp(
    Math.abs(orderFlowBias - structureBias) * 0.6 +
    (dominantSide === 'BALANCED' ? 12 : 0) +
    Math.max(0, 40 - positioningImbalance) * 0.35,
    0,
    100,
  );

  return {
    volumeNodeStrength,
    positioningImbalance,
    liquiditySkew,
    highVolumeZonePressure,
    structuralDemandSupply,
    netBias,
    dominantSide,
    dominanceStrength,
    contradictionRisk,
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
  if (orderBlock.dominanceStrength >= 68) reasons.push("ORDERBLOCK_DOMINANCE_HIGH");
  if (orderBlock.contradictionRisk >= 52) reasons.push("ORDERBLOCK_STRUCTURE_CONTRADICTION");

  if (orderBlock.dominantSide === 'LONG' && orderBlock.dominanceStrength >= 65) {
    bull += 24;
    bear -= 14;
    reasons.push('ORDERBLOCK_LIQUIDITY_LONG_OVERRIDE');
  }
  if (orderBlock.dominantSide === 'SHORT' && orderBlock.dominanceStrength >= 65) {
    bear += 24;
    bull -= 14;
    reasons.push('ORDERBLOCK_LIQUIDITY_SHORT_OVERRIDE');
  }

  if (typeof orderBookImbalance === 'number') {
    if (orderBookImbalance > 0.12) reasons.push("ORDERBOOK_BID_DOMINANCE");
    else if (orderBookImbalance < -0.12) reasons.push("ORDERBOOK_ASK_DOMINANCE");
    else reasons.push("ORDERBOOK_BALANCED");

    if (orderBookImbalance >= 0.65) {
      bull += 34;
      bear -= 24;
      reasons.push('ORDERBOOK_EXTREME_LONG_IMBALANCE');
    } else if (orderBookImbalance <= -0.65) {
      bear += 34;
      bull -= 24;
      reasons.push('ORDERBOOK_EXTREME_SHORT_IMBALANCE');
    }
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


interface InstitutionalModuleResult {
  score: number;
  quality: 'HIGH_PROBABILITY_SETUP' | 'VALID_SETUP' | 'AVOID_TRADE';
  regime: 'STRONG_TREND' | 'EXPANSION_PHASE' | 'RANGE' | 'DISTRIBUTION' | 'LOW_VOLATILITY';
  oiState: 'AGGRESSIVE_LONGS' | 'AGGRESSIVE_SHORTS' | 'SHORT_SQUEEZE' | 'LONG_SQUEEZE' | 'UNAVAILABLE' | 'NEUTRAL';
  volatilityState: 'EXPANDING' | 'CONTRACTING' | 'BALANCED';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  tradeAllowed: boolean;
  sweep: { side: 'LONG' | 'SHORT'; confirmed: boolean; level: number; time: number } | null;
  smartEntry: { side: 'LONG' | 'SHORT'; entry: number; stopLoss: number; takeProfit: number; rr: number; sizePct: number } | null;
}

const computeAdxProxy = (candles: OHLCV[]): number => {
  if (candles.length < 20) return 16;
  const recent = candles.slice(-20);
  const changes = recent.slice(1).map((c, i) => Math.abs(c.close - recent[i].close) / Math.max(recent[i].close, 1e-8));
  const drift = Math.abs(recent[recent.length - 1].close - recent[0].close) / Math.max(recent[0].close, 1e-8);
  const noise = changes.reduce((a, b) => a + b, 0) / Math.max(changes.length, 1);
  return clamp((drift / Math.max(noise, 1e-6)) * 18, 8, 55);
};

const computeInstitutionalModule = (ctx: {
  symbol: string;
  price: number;
  indicators: IndicatorValues;
  volume: number;
  prevVolume: number;
  change24h: number;
  candles?: OHLCV[];
  reasons: string[];
  side: 'LONG' | 'SHORT' | 'NONE';
  confluenceScore: number;
  orderBlock: OrderBlockSnapshot;
  rr: number;
  orderBookImbalance?: number | null;
  oiCurrent?: number | null;
  oiPrev?: number | null;
}): InstitutionalModuleResult => {
  const candles = ctx.candles ?? [];
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const highs = candles.slice(-30).map((c) => c.high);
  const lows = candles.slice(-30).map((c) => c.low);
  const prevHigh = highs.length ? Math.max(...highs.slice(0, -1)) : ctx.price;
  const prevLow = lows.length ? Math.min(...lows.slice(0, -1)) : ctx.price;

  const shortSweepConfirmed = !!latest && latest.high > prevHigh && latest.close < prevHigh;
  const longSweepConfirmed = !!latest && latest.low < prevLow && latest.close > prevLow;
  const sweep = shortSweepConfirmed
    ? { side: 'SHORT' as const, confirmed: true, level: prevHigh, time: latest.time }
    : longSweepConfirmed
      ? { side: 'LONG' as const, confirmed: true, level: prevLow, time: latest.time }
      : null;

  const volumeRatio = ctx.prevVolume > 0 ? ctx.volume / ctx.prevVolume : 1;
  const volumeSpike = volumeRatio >= 1.24;

  const oiAvailable = typeof ctx.oiCurrent === 'number' && typeof ctx.oiPrev === 'number';
  const oiDelta = oiAvailable ? (ctx.oiCurrent! - ctx.oiPrev!) / Math.max(Math.abs(ctx.oiPrev!), 1e-8) : 0;
  const priceDelta = latest && previous ? (latest.close - previous.close) / Math.max(previous.close, 1e-8) : 0;

  let oiState: InstitutionalModuleResult['oiState'] = 'UNAVAILABLE';
  if (oiAvailable) {
    if (priceDelta > 0 && oiDelta > 0) oiState = 'AGGRESSIVE_LONGS';
    else if (priceDelta < 0 && oiDelta > 0) oiState = 'AGGRESSIVE_SHORTS';
    else if (priceDelta > 0 && oiDelta < 0) oiState = 'SHORT_SQUEEZE';
    else if (priceDelta < 0 && oiDelta < 0) oiState = 'LONG_SQUEEZE';
    else oiState = 'NEUTRAL';
  }

  const mssConfirmed = ctx.reasons.some((r) => r.includes('BREAK_OF_STRUCTURE') || r.includes('CHOCH'));
  const cleanRetest = ctx.reasons.some((r) => r.includes('ORDERBLOCK_DEMAND_DOMINANT') || r.includes('ORDERBLOCK_SUPPLY_DOMINANT'));

  const atrPct = ctx.price > 0 ? ctx.indicators.atr / ctx.price : 0;
  const bbWidth = ctx.price > 0 ? (ctx.indicators.bb.upper - ctx.indicators.bb.lower) / ctx.price : 0;
  const adxProxy = computeAdxProxy(candles);
  const volContracting = bbWidth < 0.035 && atrPct < 0.0068;
  const volExpanding = bbWidth > 0.082 || atrPct > 0.018;

  let regime: InstitutionalModuleResult['regime'] = 'RANGE';
  if (volContracting) regime = 'LOW_VOLATILITY';
  else if (adxProxy >= 31 && Math.abs(ctx.change24h) >= 2) regime = 'STRONG_TREND';
  else if (volExpanding && adxProxy >= 22) regime = 'EXPANSION_PHASE';
  else if (Math.abs(ctx.change24h) >= 5.5 && adxProxy < 21) regime = 'DISTRIBUTION';

  const volatilityState: InstitutionalModuleResult['volatilityState'] = volExpanding ? 'EXPANDING' : volContracting ? 'CONTRACTING' : 'BALANCED';
  const bias: InstitutionalModuleResult['bias'] = ctx.side === 'LONG' ? 'BULLISH' : ctx.side === 'SHORT' ? 'BEARISH' : 'NEUTRAL';

  const oiDivergence = oiState === 'SHORT_SQUEEZE' || oiState === 'LONG_SQUEEZE' || oiState === 'AGGRESSIVE_LONGS' || oiState === 'AGGRESSIVE_SHORTS';
  const fundingExtreme = typeof ctx.orderBookImbalance === 'number' && Math.abs(ctx.orderBookImbalance) >= 0.62;

  let institutionalScore = 0;
  if (sweep?.confirmed) institutionalScore += 20;
  if (oiDivergence) institutionalScore += 15;
  if (volumeSpike) institutionalScore += 15;
  if (mssConfirmed) institutionalScore += 20;
  if (fundingExtreme) institutionalScore += 10;
  if (cleanRetest) institutionalScore += 20;
  institutionalScore = clamp(institutionalScore, 0, 100);

  const quality = institutionalScore >= 80 ? 'HIGH_PROBABILITY_SETUP' : institutionalScore >= 60 ? 'VALID_SETUP' : 'AVOID_TRADE';
  const tradeAllowed = regime !== 'LOW_VOLATILITY' && institutionalScore >= 60;

  const directionalOiConfirm = (ctx.side === 'LONG' && (oiState === 'AGGRESSIVE_LONGS' || oiState === 'SHORT_SQUEEZE'))
    || (ctx.side === 'SHORT' && (oiState === 'AGGRESSIVE_SHORTS' || oiState === 'LONG_SQUEEZE'));
  const smartEntryAllowed = !!sweep?.confirmed
    && mssConfirmed
    && directionalOiConfirm
    && volumeSpike
    && institutionalScore >= 60
    && ctx.side !== 'NONE';

  let smartEntry: InstitutionalModuleResult['smartEntry'] = null;
  if (smartEntryAllowed) {
    const atr = Math.max(ctx.indicators.atr, ctx.price * 0.0015);
    const liqAnchor = sweep?.level ?? ctx.price;
    const stopLoss = ctx.side === 'LONG' ? Math.min(liqAnchor - atr * 0.6, ctx.price - atr * 0.85) : Math.max(liqAnchor + atr * 0.6, ctx.price + atr * 0.85);
    const risk = Math.max(Math.abs(ctx.price - stopLoss), ctx.price * 0.0008);
    const takeProfit = ctx.side === 'LONG' ? ctx.price + risk * 3.2 : ctx.price - risk * 3.2;
    const rr = Math.abs(takeProfit - ctx.price) / risk;
    const riskAdj = regime === 'STRONG_TREND' ? 1 : regime === 'LOW_VOLATILITY' ? 0.45 : 0.72;
    const sizePct = clamp((institutionalScore / 100) * riskAdj * (rr >= 3 ? 1 : 0.7), 0.1, 1);
    smartEntry = {
      side: ctx.side,
      entry: ctx.price,
      stopLoss,
      takeProfit,
      rr,
      sizePct: Number((sizePct * 100).toFixed(1)),
    };
  }

  return {
    score: institutionalScore,
    quality,
    regime,
    oiState,
    volatilityState,
    bias,
    tradeAllowed,
    sweep,
    smartEntry,
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
  oiCurrent?: number | null,
  oiPrev?: number | null,
): MarketAnalysis => {
  hydratePerfectMemory();
  const nowTs = Date.now();
  resetDailyScoringIfNeeded(nowTs);

  const { bullishStrength, bearishStrength, reasons, volumeRatio, orderBlock } = calculateForwardScores({
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

  const extremeLiquidityDominance = orderBlock.dominanceStrength >= 75;
  const longDominance = orderBlock.dominantSide === 'LONG';
  const shortDominance = orderBlock.dominantSide === 'SHORT';
  const liquidityContradiction =
    (marketCondition === 'BEARISH' && longDominance && extremeLiquidityDominance) ||
    (marketCondition === 'BULLISH' && shortDominance && extremeLiquidityDominance);

  if (liquidityContradiction) {
    reasons.push('LIQUIDITY_STRUCTURE_CONTRADICTION');
    marketCondition = 'NEUTRAL';
    bias = SignalBias.NEUTRAL;
  }

  const trendSlope = price > 0 ? (indicators.ema20 - indicators.ema50) / price : 0;
  const macroSlope = price > 0 ? (indicators.ema50 - indicators.ema200) / price : 0;
  const atrPct = price > 0 ? indicators.atr / price : 0;
  const momentum = indicators.macd.histogram;
  const stochUp = indicators.stochRsi.k > indicators.stochRsi.d;
  const stochDown = indicators.stochRsi.k < indicators.stochRsi.d;
  const strongBull = bias === SignalBias.STRONG_BUY || bias === SignalBias.BUY;
  const strongBear = bias === SignalBias.STRONG_SELL || bias === SignalBias.SELL;
  const side: 'LONG' | 'SHORT' | 'NONE' = strongBull ? 'LONG' : strongBear ? 'SHORT' : 'NONE';

  const trendConfirmed = (trendSlope > 0.0022 && macroSlope > 0.0036 && strongBull) || (trendSlope < -0.0022 && macroSlope < -0.0036 && strongBear);
  const candleConfirmed = reasons.some((r) => side === 'LONG' ? r.includes('CANDLE_BULL') || r.includes('ENGULFING') || r.includes('PINBAR_BULL') : side === 'SHORT' ? r.includes('CANDLE_BEAR') || r.includes('ENGULFING') || r.includes('PINBAR_BEAR') : false);
  const orderBlockAligned = reasons.some((r) => (side === 'LONG' && r === 'ORDERBLOCK_DEMAND_DOMINANT') || (side === 'SHORT' && r === 'ORDERBLOCK_SUPPLY_DOMINANT'));
  const orderBlockDominanceAligned = side === 'NONE'
    ? false
    : orderBlock.dominantSide === 'BALANCED'
      ? orderBlockAligned
      : orderBlock.dominantSide === side;
  const contradictionDetected = side !== 'NONE' && orderBlock.dominantSide !== 'BALANCED' && orderBlock.dominantSide !== side && orderBlock.dominanceStrength >= 68;
  const volumeConfirmed = volumeRatio >= 1.15;
  const momentumConfirmed = (side === 'LONG' && momentum > 0 && stochUp) || (side === 'SHORT' && momentum < 0 && stochDown);
  const volatilityAligned = atrPct >= 0.007 && atrPct <= 0.028;
  const structureConfirmed = reasons.some((r) => (side === 'LONG' && (r === 'STRUCTURE_HH_HL_BULL' || r === 'STRUCTURE_CHOCH_BULL')) || (side === 'SHORT' && (r === 'STRUCTURE_LH_LL_BEAR' || r === 'STRUCTURE_CHOCH_BEAR')));

  const slAtrMultiplier = contradictionDetected
    ? 0.8
    : orderBlockDominanceAligned && orderBlock.dominanceStrength >= 65
      ? 1.45
      : 1.2;

  const slBase = side === 'LONG'
    ? Math.max(price - indicators.atr * slAtrMultiplier, price * 0.6)
    : side === 'SHORT'
      ? price + indicators.atr * slAtrMultiplier
      : price;
  const tpBase = side === 'LONG'
    ? price + indicators.atr * 3.9
    : side === 'SHORT'
      ? Math.max(price - indicators.atr * 3.9, price * 0.25)
      : price;
  const risk = Math.max(Math.abs(price - slBase), price * 0.0001);
  const reward = Math.max(Math.abs(tpBase - price), 0);
  const rr = reward / risk;
  const rrConfirmed = rr >= 3;

  const weightedChecks = [
    { ok: trendConfirmed, weight: 14 },
    { ok: candleConfirmed, weight: 8 },
    { ok: orderBlockAligned, weight: 18 },
    { ok: orderBlockDominanceAligned, weight: 20 },
    { ok: !contradictionDetected, weight: 14 },
    { ok: volumeConfirmed, weight: 8 },
    { ok: momentumConfirmed, weight: 8 },
    { ok: volatilityAligned, weight: 5 },
    { ok: structureConfirmed, weight: 5 },
  ];
  const confluenceScore = weightedChecks.reduce((acc, item) => acc + (item.ok ? item.weight : 0), 0);
  const strictAligned = weightedChecks.every((item) => item.ok) && side !== 'NONE' && rrConfirmed;

  const institutional = computeInstitutionalModule({
    symbol,
    price,
    indicators,
    volume,
    prevVolume,
    change24h,
    candles,
    reasons,
    side,
    confluenceScore,
    orderBlock,
    rr,
    orderBookImbalance,
    oiCurrent,
    oiPrev,
  });

  const prevPerfect = PERFECT_TRADE_MEMORY.get(symbol) ?? {
    robustScore: 0,
    confluenceScore: 0,
    holdMs: 0,
    lastTs: Date.now(),
    active: false,
  };
  const elapsedMs = clamp(Math.max(0, nowTs - prevPerfect.lastTs), 0, 120_000);
  const momentumFactor = clamp(Math.abs(momentum) * 4200, 0, 9);
  const addPerMinute = 8 + (confluenceScore / 100) * 10 + momentumFactor * 0.35 + institutional.score * 0.04;
  const decayPerMinute = 16 + (100 - confluenceScore) * 0.08;
  const deltaScore = strictAligned ? addPerMinute * (elapsedMs / 60_000) : -decayPerMinute * (elapsedMs / 60_000);
  const robustScore = clamp(prevPerfect.robustScore * 0.84 + deltaScore, -100, 100);
  const holdMs = strictAligned ? Math.min(prevPerfect.holdMs + elapsedMs, 45 * 60_000) : Math.max(0, prevPerfect.holdMs - elapsedMs * 1.4);
  const holdMinutes = holdMs / 60_000;
  const threshold = contradictionDetected ? 82 : institutional.score >= 80 ? 70 : 74;
  const minStabilityMinutes = 2.5;
  const deactivateThreshold = contradictionDetected ? 70 : 64;
  const isActive = prevPerfect.active
    ? robustScore >= deactivateThreshold && holdMinutes >= minStabilityMinutes * 0.6
    : robustScore >= threshold && holdMinutes >= minStabilityMinutes && strictAligned;

  PERFECT_TRADE_MEMORY.set(symbol, {
    robustScore,
    confluenceScore,
    holdMs,
    lastTs: nowTs,
    active: isActive,
  });

  const keysByScore = Array.from(PERFECT_TRADE_MEMORY.entries())
    .map(([key, state]) => ({ key, score: state.robustScore }))
    .sort((a, b) => b.score - a.score);
  const bestKey = keysByScore[0]?.key ?? null;
  const worstKey = keysByScore[keysByScore.length - 1]?.key ?? null;
  persistPerfectMemory();

  const perfectSummary = [
    'PERFECT_SUMMARY_CONFLUENCE_ALIGNMENT',
    'PERFECT_SUMMARY_STABILITY_ROBUST',
    side === 'LONG'
      ? 'PERFECT_SUMMARY_CONTINUATION_LONG'
      : side === 'SHORT'
        ? 'PERFECT_SUMMARY_CONTINUATION_SHORT'
        : 'PERFECT_SUMMARY_CONTINUATION_NEUTRAL',
  ];
  const perfectExpectations = [
    side === 'LONG'
      ? 'PERFECT_EXPECT_BID_PRESSURE'
      : side === 'SHORT'
        ? 'PERFECT_EXPECT_ASK_PRESSURE'
        : 'PERFECT_EXPECT_NO_DIRECTION',
    'PERFECT_EXPECT_RISK_FRAMEWORK',
    strictAligned ? 'PERFECT_EXPECT_NOISE_FILTERED' : 'PERFECT_EXPECT_BUILDING_PHASE',
  ];

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

  const finalScore = Math.round(clamp(conditionStrength * 0.68 + institutional.score * 0.32, 0, 100));
  const dedupedReasons = Array.from(new Set([...(institutional.sweep ? [institutional.sweep.side === 'LONG' ? 'LIQUIDITY_SWEEP_LONG_CONFIRMED' : 'LIQUIDITY_SWEEP_SHORT_CONFIRMED'] : []), ...reasons])).slice(0, 16);

  return {
    symbol,
    price,
    change24h,
    volume24h: volume,
    indicators,
    marketCondition,
    conditionStrength,
    score: finalScore,
    bias,
    reasons: dedupedReasons,
    events: {
      volumeSpike: volumeRatio >= 1.2,
      trendBreak: dedupedReasons.some((r) => r.includes('BREAK_OF_STRUCTURE') || r.includes('CHOCH')),
      highScore: finalScore >= 75,
      liquidityContradiction: liquidityContradiction || contradictionDetected,
    },
    earlySignal: {
      side: earlySide,
      confidence: Math.max(earlyLongScore, earlyShortScore),
      reasons: earlyReasons,
    },
    perfectTrade: {
      active: isActive,
      robustScore: Number(robustScore.toFixed(2)),
      confluenceScore,
      threshold,
      stabilityMinutes: Number(holdMinutes.toFixed(2)),
      holdMinutes: Number(minStabilityMinutes.toFixed(2)),
      side,
      rr: Number((institutional.smartEntry?.rr ?? rr).toFixed(2)),
      tp: Number.isFinite(institutional.smartEntry?.takeProfit ?? tpBase) ? (institutional.smartEntry?.takeProfit ?? tpBase) : null,
      sl: Number.isFinite(institutional.smartEntry?.stopLoss ?? slBase) ? (institutional.smartEntry?.stopLoss ?? slBase) : null,
      summary: perfectSummary,
      expectations: perfectExpectations,
      bestKey,
      worstKey,
    },
    institutional: {
      score: institutional.score,
      quality: institutional.quality,
      regime: institutional.regime,
      oiState: institutional.oiState,
      volatilityState: institutional.volatilityState,
      bias: institutional.bias,
      tradeAllowed: institutional.tradeAllowed,
      sweep: institutional.sweep,
      smartEntry: institutional.smartEntry,
    },
    timestamp: nowTs,
  };
};
