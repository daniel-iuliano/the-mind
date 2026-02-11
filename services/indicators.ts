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

  // Calculate K and D lines (SMA of StochRSI)
  const kLine = calculateSMA(stochRsi.map(v => isNaN(v) ? 0 : v), kPeriod);
  const dLine = calculateSMA(kLine.map(v => isNaN(v) ? 0 : v), dPeriod);

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
  const tr = [0];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const trVal = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(trVal);
  }
  // RMA (Running Moving Average) is standard for ATR, but SMA is often close enough for simple usage. 
  // We'll use SMA for stability in this demo.
  return calculateSMA(tr, period);
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
    rsi: rsiArr[idx] || 50,
    stochRsi: {
        k: stoch.kLine[idx] || 50,
        d: stoch.dLine[idx] || 50
    },
    macd: {
      macd: macdVal,
      signal: signalVal,
      histogram: macdVal - signalVal
    },
    ema20: ema20Arr[idx] || closes[idx],
    ema50: ema50Arr[idx] || closes[idx],
    ema200: ema200Arr[idx] || closes[idx],
    bb: bbArr[idx] || { upper: 0, lower: 0, middle: 0 },
    atr: atrArr[idx] || 0
  };
};

export const calculateOrderBlockLevels = (candles: OHLCV[]): OrderBlockLevel[] => {
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

  return deduped.sort((a, b) => a.price - b.price);
};
