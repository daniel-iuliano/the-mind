import { IndicatorValues, MarketAnalysis, SignalBias } from "../types";
import { SCORING } from "../constants";

export const scoreMarket = (symbol: string, price: number, indicators: IndicatorValues, volume: number, prevVolume: number, change24h: number): MarketAnalysis => {
  let score = 50; // Neutral start
  const reasons: string[] = [];
  let bias = SignalBias.NEUTRAL;

  // 1. RSI Analysis (Mean Reversion / Momentum)
  if (indicators.rsi < 30) {
    score += SCORING.RSI_WEIGHT;
    reasons.push(`RSI Sobrevendido (${indicators.rsi.toFixed(1)})`);
  } else if (indicators.rsi > 70) {
    score -= SCORING.RSI_WEIGHT;
    reasons.push(`RSI Sobrecomprado (${indicators.rsi.toFixed(1)})`);
  }

  // 2. Stochastic RSI (Confirmation)
  if (indicators.stochRsi.k < 20 && indicators.stochRsi.d < 20 && indicators.stochRsi.k > indicators.stochRsi.d) {
    score += 10;
    reasons.push("Cruce Alcista de StochRSI en Zona de Compra");
  } else if (indicators.stochRsi.k > 80 && indicators.stochRsi.d > 80 && indicators.stochRsi.k < indicators.stochRsi.d) {
    score -= 10;
    reasons.push("Cruce Bajista de StochRSI en Zona de Venta");
  }

  // 3. Trend Analysis (EMA)
  const isBullishTrend = price > indicators.ema50 && indicators.ema50 > indicators.ema200;
  const isBearishTrend = price < indicators.ema50 && indicators.ema50 < indicators.ema200;

  if (isBullishTrend) {
    score += SCORING.TREND_WEIGHT;
    reasons.push("Alineación de EMAs Fuertemente Alcista (20>50>200)");
  } else if (isBearishTrend) {
    score -= SCORING.TREND_WEIGHT;
    reasons.push("Alineación de EMAs Fuertemente Bajista (20<50<200)");
  }

  // 4. MACD Momentum
  const histogram = indicators.macd.histogram;
  if (histogram > 0 && histogram > indicators.macd.signal) {
     score += 10;
     reasons.push("Histograma MACD Creciendo (Alcista)");
  } else if (histogram < 0 && histogram < indicators.macd.signal) {
     score -= 10;
     reasons.push("Histograma MACD Decreciendo (Bajista)");
  }

  // 5. Bollinger Bands (Dynamic S/R)
  if (price <= indicators.bb.lower) {
    score += 15;
    reasons.push("Precio rebotando en Banda Bollinger Inferior");
  } else if (price >= indicators.bb.upper) {
    score -= 15;
    reasons.push("Precio rechazado en Banda Bollinger Superior");
  }

  // 6. Volatility Filter (ATR)
  // If ATR is extremely low relative to price, volatility is dead (squeeze)
  const volatilityRatio = indicators.atr / price;
  if (volatilityRatio < 0.005) { // < 0.5% movement avg
      reasons.push("Baja Volatilidad (El mercado está planchado)");
      // Reduce strong signals in low vol environments as they are often fakeouts
      if (score > 70) score -= 10; 
      if (score < 30) score += 10;
  }

  // 7. Volume Confirmation
  if (volume > prevVolume * 1.5) {
      if (score > 60) {
          score += 5;
          reasons.push("Confirmación por Alto Volumen");
      } else if (score < 40) {
          score -= 5;
          reasons.push("Presión de Venta con Alto Volumen");
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