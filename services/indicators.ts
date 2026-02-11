import { OHLCV, IndicatorValues, SupportResistanceLevel, OrderBlockLevel } from "../types";

// Helper: Calculate average
const avg = (data: number[]) => data.reduce((a, b) => a + b, 0) / data.length;

// Standard Deviation
const stdDev = (data: number[]) => {
  const mean = avg(data);
  const squareDiffs = data.map((value) => Math.pow(value - mean, 2));
  return Math.sqrt(avg(squareDiffs));
};

export const calculateSMA = (data: number[], period: number): number[] => {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    sma.push(avg(slice));
  }
  return sma;
};

export const calculateEMA = (data: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const ema = [data[0]]; // Start with first price approximation
  for (let i = 1; i < data.length; i++) {
    const prev = ema[i - 1];
    if (isNaN(prev)) {
        ema.push(data[i]);
    } else {
        ema.push(data[i] * k + prev * (1 - k));
    }
  }
  return ema;
};

export const calculateRSI = (closePrices: number[], period = 14): number[] => {
  const rsiArray: number[] = [];
  let gains = 0;
  let losses = 0;

  if (closePrices.length < period) return new Array(closePrices.length).fill(50);

  // First period
  for (let i = 1; i <= period; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Initial RSI
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiArray.push(100 - 100 / (1 + rs));

  // Smoothing
  for (let i = period + 1; i < closePrices.length; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiArray.push(100 - 100 / (1 + rs));
  }
  
  // Pad the beginning to match length
  return new Array(period).fill(NaN).concat(rsiArray);
};

export const calculateStochRSI = (rsiValues: number[], period = 14, kPeriod = 3, dPeriod = 3) => {
  const stochRsi: number[] = [];
  
  for (let i = 0; i < rsiValues.length; i++) {
    if (i < period - 1 || isNaN(rsiValues[i])) {
      stochRsi.push(NaN);
      continue;
    }
    const slice = rsiValues.slice(i - period + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    const k = max === min ? 0 : (rsiValues[i] - min) / (max - min);
    stochRsi.push(k * 100);
  }

  // Calculate K and D lines (SMA of StochRSI) preserving warmup NaN values
  const kRaw = calculateSMA(stochRsi, kPeriod);
  const dRaw = calculateSMA(kRaw, dPeriod);
  const kLine = kRaw.map((v, i) => (Number.isFinite(stochRsi[i]) ? v : NaN));
  const dLine = dRaw.map((v, i) => (Number.isFinite(kLine[i]) ? v : NaN));

  return { kLine, dLine };
};

export const calculateMACD = (closePrices: number[], fast = 12, slow = 26, signal = 9) => {
  const emaFast = calculateEMA(closePrices, fast);
  const emaSlow = calculateEMA(closePrices, slow);
  
  const macdLine = closePrices.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signal);
  
  return {
    macdLine,
    signalLine
  };
};

export const calculateBollingerBands = (closePrices: number[], period = 20, multiplier = 2) => {
  const sma = calculateSMA(closePrices, period);
  const bands = closePrices.map((_, i) => {
    if (i < period - 1) return { upper: NaN, lower: NaN, middle: NaN };
    const slice = closePrices.slice(i - period + 1, i + 1);
    const sd = stdDev(slice);
    return {
      middle: sma[i],
      upper: sma[i] + sd * multiplier,
      lower: sma[i] - sd * multiplier
    };
  });
  return bands;
};

export const calculateATR = (candles: OHLCV[], period = 14): number[] => {
  if (candles.length === 0) return [];

  const tr: number[] = [NaN];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const trVal = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    tr.push(trVal);
  }

  const atr = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return atr;

  const seed = tr.slice(1, period + 1).reduce((acc, x) => acc + x, 0) / period;
  atr[period] = seed;

  for (let i = period + 1; i < tr.length; i++) {
    atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
  }

  return atr;
};

// --- Support and Resistance Calculation ---
export const calculateSupportResistance = (candles: OHLCV[], thresholdPercent = 0.02): SupportResistanceLevel[] => {
  const levels: SupportResistanceLevel[] = [];
  // Look for pivot points (fractals)
  // A High pivot is a high surrounded by lower highs
  // A Low pivot is a low surrounded by higher lows
  const pivotPeriod = 5; 

  if (candles.length < pivotPeriod * 2) return [];

  const potentialLevels: number[] = [];

  for (let i = pivotPeriod; i < candles.length - pivotPeriod; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;
    
    let isHighPivot = true;
    let isLowPivot = true;

    for (let j = 1; j <= pivotPeriod; j++) {
      if (candles[i - j].high > currentHigh || candles[i + j].high > currentHigh) isHighPivot = false;
      if (candles[i - j].low < currentLow || candles[i + j].low < currentLow) isLowPivot = false;
    }

    if (isHighPivot) potentialLevels.push(currentHigh);
    if (isLowPivot) potentialLevels.push(currentLow);
  }

  // Consolidate levels that are close to each other
  const consolidatedLevels: {price: number, count: number}[] = [];
  
  potentialLevels.sort((a, b) => a - b);

  potentialLevels.forEach(price => {
      let found = false;
      for (const level of consolidatedLevels) {
          const diff = Math.abs(level.price - price);
          const percentDiff = diff / level.price;
          // If within threshold, average it
          if (percentDiff < thresholdPercent) {
              level.price = (level.price * level.count + price) / (level.count + 1);
              level.count++;
              found = true;
              break;
          }
      }
      if (!found) {
          consolidatedLevels.push({ price, count: 1 });
      }
  });

  const currentPrice = candles[candles.length - 1].close;

  // Classify as Support or Resistance based on current price
  return consolidatedLevels
    .filter(l => l.count >= 2) // Filter weak levels
    .map((l) => ({
        price: l.price,
        strength: l.count,
        type: (l.price > currentPrice ? 'resistance' : 'support') as 'resistance' | 'support'
    }))
    .sort((a, b) => b.strength - a.strength) // Sort by strength
    .slice(0, 5); // Take top 5 strongest levels
};


// Main wrapper
export const analyzeCandles = (candles: OHLCV[]): IndicatorValues => {
  const closes = candles.map(c => c.close);
  
  const rsiArr = calculateRSI(closes);
  const stoch = calculateStochRSI(rsiArr);
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);
  const bbArr = calculateBollingerBands(closes);
  const atrArr = calculateATR(candles);
  
  const { macdLine, signalLine } = calculateMACD(closes);
  
  const idx = closes.length - 1;
  const macdVal = macdLine[idx] || 0;
  const signalVal = signalLine[idx] || 0;

  return {
    rsi: Number.isFinite(rsiArr[idx]) ? rsiArr[idx] : 50,
    stochRsi: {
        k: Number.isFinite(stoch.kLine[idx]) ? stoch.kLine[idx] : 50,
        d: Number.isFinite(stoch.dLine[idx]) ? stoch.dLine[idx] : 50
    },
    macd: {
      macd: macdVal,
      signal: signalVal,
      histogram: macdVal - signalVal
    },
    ema20: Number.isFinite(ema20Arr[idx]) ? ema20Arr[idx] : closes[idx],
    ema50: Number.isFinite(ema50Arr[idx]) ? ema50Arr[idx] : closes[idx],
    ema200: Number.isFinite(ema200Arr[idx]) ? ema200Arr[idx] : closes[idx],
    bb: bbArr[idx] && Number.isFinite(bbArr[idx].middle) ? bbArr[idx] : { upper: 0, lower: 0, middle: 0 },
    atr: Number.isFinite(atrArr[idx]) ? atrArr[idx] : 0
  };
};

export const calculateOrderBlockLevels = (candles: OHLCV[], oiSeries?: number[]): OrderBlockLevel[] => {
  if (candles.length < 20) return [];

  const lookback = candles.slice(-120);
  const volumes = lookback.map((c) => c.volume);
  const avgVolume = volumes.reduce((acc, v) => acc + v, 0) / Math.max(volumes.length, 1);
  const sortedVolumes = [...volumes].sort((a, b) => a - b);
  const highVolumeThreshold = sortedVolumes[Math.floor(sortedVolumes.length * 0.82)] || avgVolume;

  const highs = lookback.map((c) => c.high);
  const lows = lookback.map((c) => c.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const range = Math.max(rangeHigh - rangeLow, 1e-8);
  const latestClose = lookback[lookback.length - 1].close;

  const levels: OrderBlockLevel[] = [];

  for (let i = 2; i < lookback.length - 2; i++) {
    const c = lookback[i];
    const body = Math.abs(c.close - c.open);
    const wick = c.high - c.low;
    const volumeSpike = c.volume >= highVolumeThreshold;
    const displacement = body > wick * 0.45;

    if (volumeSpike && displacement) {
      const bullish = c.close > c.open;
      const type = bullish ? 'demand' : 'supply';
      const zonePad = Math.max(wick * 0.15, range * 0.0035);
      const zoneLow = Math.max(rangeLow, Math.min(c.open, c.close) - zonePad);
      const zoneHigh = Math.min(rangeHigh, Math.max(c.open, c.close) + zonePad);
      levels.push({
        type,
        price: (zoneLow + zoneHigh) / 2,
        strength: Math.min(100, Math.round((c.volume / avgVolume) * 35 + (body / Math.max(wick, 1e-8)) * 45)),
        label: bullish ? 'Demand OB' : 'Supply OB',
        zone: { low: zoneLow, high: zoneHigh },
      });
    }

    const nearRound = Math.abs((c.close / range) - Math.round(c.close / range)) < 0.005;
    if (volumeSpike && nearRound) {
      levels.push({
        type: 'liquidity',
        price: c.close,
        strength: Math.min(100, Math.round((c.volume / avgVolume) * 40)),
        label: 'Liquidity cluster',
      });
    }

    if (volumeSpike) {
      levels.push({
        type: 'highVolume',
        price: (c.high + c.low) / 2,
        strength: Math.min(100, Math.round((c.volume / avgVolume) * 38)),
        label: 'High-volume node',
      });
    }

    const prev = lookback[i - 1];
    const hasGapUp = c.low > prev.high * 1.0004;
    const hasGapDown = c.high < prev.low * 0.9996;
    if (hasGapUp || hasGapDown) {
      const top = hasGapUp ? c.low : prev.low;
      const bottom = hasGapUp ? prev.high : c.high;
      levels.push({
        type: 'imbalance',
        price: (top + bottom) / 2,
        strength: Math.min(100, Math.round((Math.abs(top - bottom) / range) * 3000)),
        label: 'Imbalance',
        zone: { low: Math.min(bottom, top), high: Math.max(bottom, top) },
      });
    }
  }

  const deduped = levels
    .sort((a, b) => b.strength - a.strength)
    .filter((level, idx, arr) => !arr.slice(0, idx).some((other) => other.type === level.type && Math.abs(other.price - level.price) / Math.max(level.price, 1e-8) < 0.0025))
    .slice(0, 18);

  const fallbackBand = range * 0.01;
  if (!deduped.some((l) => l.type === 'demand')) {
    deduped.push({
      type: 'demand',
      price: latestClose - fallbackBand,
      strength: 50,
      label: 'Demand OB',
      zone: { low: latestClose - fallbackBand * 1.6, high: latestClose - fallbackBand * 0.4 },
    });
  }
  if (!deduped.some((l) => l.type === 'supply')) {
    deduped.push({
      type: 'supply',
      price: latestClose + fallbackBand,
      strength: 50,
      label: 'Supply OB',
      zone: { low: latestClose + fallbackBand * 0.4, high: latestClose + fallbackBand * 1.6 },
    });
  }

  const liquidityMap = detectLiquidityHeatmapLevels(candles, oiSeries);
  return [...deduped, ...liquidityMap]
    .sort((a, b) => b.strength - a.strength)
    .filter((level, idx, arr) => !arr.slice(0, idx).some((x) => x.type === level.type && Math.abs(x.price - level.price) / Math.max(level.price, 1e-8) < 0.0018))
    .sort((a, b) => a.price - b.price);
};


const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const detectLiquidityHeatmapLevels = (candles: OHLCV[], oiSeries?: number[]): OrderBlockLevel[] => {
  if (candles.length < 18) return [];
  const lookback = candles.slice(-160);
  const volumes = lookback.map((c) => c.volume);
  const volBase = Math.max(median(volumes), 1e-8);
  const highs = lookback.map((c) => c.high);
  const lows = lookback.map((c) => c.low);
  const range = Math.max(Math.max(...highs) - Math.min(...lows), 1e-8);
  const eqTolerance = range * 0.0018;

  const clusters: Array<{ idx: number; price: number; side: 'SHORT' | 'LONG'; touches: number; label: string; }> = [];

  for (let i = 3; i < lookback.length - 3; i++) {
    const c = lookback[i];
    const prev = lookback[i - 1];
    const next = lookback[i + 1];
    const isSwingHigh = c.high > prev.high && c.high > next.high;
    const isSwingLow = c.low < prev.low && c.low < next.low;

    if (isSwingHigh) {
      const touches = lookback.filter((x) => Math.abs(x.high - c.high) <= eqTolerance).length;
      if (touches >= 2) {
        clusters.push({ idx: i, price: c.high, side: 'SHORT', touches, label: touches >= 3 ? 'Equal Highs pool' : 'Swing High liquidity' });
      }
    }

    if (isSwingLow) {
      const touches = lookback.filter((x) => Math.abs(x.low - c.low) <= eqTolerance).length;
      if (touches >= 2) {
        clusters.push({ idx: i, price: c.low, side: 'LONG', touches, label: touches >= 3 ? 'Equal Lows pool' : 'Swing Low liquidity' });
      }
    }
  }

  const levels: OrderBlockLevel[] = [];
  const lastIndex = lookback.length - 1;
  for (const cluster of clusters) {
    const c = lookback[cluster.idx];
    const volSpike = c.volume / volBase;
    const oiDelta = oiSeries && oiSeries.length > cluster.idx + 1
      ? ((oiSeries[cluster.idx] - oiSeries[Math.max(0, cluster.idx - 1)]) / Math.max(Math.abs(oiSeries[Math.max(0, cluster.idx - 1)]), 1e-8))
      : 0;

    let mitigationIdx = lastIndex;
    for (let j = cluster.idx + 1; j < lookback.length; j++) {
      const test = lookback[j];
      const touched = cluster.side === 'SHORT' ? test.high >= cluster.price : test.low <= cluster.price;
      const rejected = cluster.side === 'SHORT' ? test.close < cluster.price : test.close > cluster.price;
      if (touched && rejected) {
        mitigationIdx = j;
        break;
      }
    }

    const intensity = Math.min(1, Math.max(0.12, volSpike * 0.52 + Math.abs(oiDelta) * 6 + cluster.touches * 0.12));
    const zonePad = Math.max(range * 0.0022, Math.abs(c.high - c.low) * 0.22);
    levels.push({
      type: 'liquidityPool',
      price: cluster.price,
      side: cluster.side,
      intensity,
      strength: Math.min(100, Math.round(intensity * 100)),
      label: cluster.side === 'SHORT' ? `${cluster.label} • stops above highs` : `${cluster.label} • stops below lows`,
      mitigated: mitigationIdx < lastIndex,
      zone: {
        low: cluster.price - zonePad,
        high: cluster.price + zonePad,
        startTime: lookback[cluster.idx].time,
        endTime: lookback[Math.max(mitigationIdx, cluster.idx)].time,
      },
    });

    const sweepCandle = lookback[Math.min(mitigationIdx, lastIndex)];
    const isSweep = cluster.side === 'SHORT'
      ? sweepCandle.high > cluster.price && sweepCandle.close < cluster.price
      : sweepCandle.low < cluster.price && sweepCandle.close > cluster.price;
    if (isSweep) {
      levels.push({
        type: 'sweep',
        price: cluster.price,
        side: cluster.side,
        intensity: Math.min(1, intensity + 0.14),
        strength: Math.min(100, Math.round(intensity * 100) + 8),
        label: cluster.side === 'SHORT' ? 'Short-side liquidity sweep' : 'Long-side liquidity sweep',
        zone: {
          low: cluster.price - zonePad * 0.6,
          high: cluster.price + zonePad * 0.6,
          startTime: sweepCandle.time,
          endTime: sweepCandle.time,
        },
      });
    }
  }

  for (let i = 2; i < lookback.length - 1; i++) {
    const c = lookback[i];
    const spread = Math.max(c.high - c.low, 1e-8);
    const body = Math.abs(c.close - c.open);
    const wickDominance = Math.max(c.high - Math.max(c.open, c.close), Math.min(c.open, c.close) - c.low) / spread;
    const volSpike = c.volume / volBase;
    const lowSpreadHighVolume = spread / Math.max(c.close, 1e-8) < 0.004 && volSpike > 1.25;
    const displacementImbalance = body / spread < 0.28 && volSpike > 1.35;
    if (wickDominance > 0.58 && (lowSpreadHighVolume || displacementImbalance)) {
      levels.push({
        type: 'absorption',
        price: (c.high + c.low) / 2,
        side: c.close >= c.open ? 'LONG' : 'SHORT',
        intensity: Math.min(1, volSpike * 0.45 + wickDominance * 0.4),
        strength: Math.min(100, Math.round(volSpike * 42 + wickDominance * 38)),
        label: 'Absorption / orderflow proxy',
        zone: { low: c.low, high: c.high, startTime: c.time, endTime: c.time },
      });
    }
  }

  return levels
    .sort((a, b) => b.strength - a.strength)
    .filter((level, idx, arr) => !arr.slice(0, idx).some((x) => x.type === level.type && Math.abs(x.price - level.price) / Math.max(level.price, 1e-8) < 0.0018))
    .slice(0, 24);
};
