import { MarketAnalysis, SupportResistanceLevel, PredictionResult, SignalBias } from "../types";

export const generatePrediction = (
  analysis: MarketAnalysis, 
  levels: SupportResistanceLevel[]
): PredictionResult => {
  const currentPrice = analysis.price;
  const atr = analysis.indicators.atr;
  const isBuy = analysis.bias.includes('BUY');
  const isSell = analysis.bias.includes('SELL');

  let predictionBias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL' = 'NEUTRAL';
  if (isBuy) predictionBias = 'ALCISTA';
  else if (isSell) predictionBias = 'BAJISTA';

  // --- Probability Calculation ---
  // Base probability starts at 50%.
  // We add to it based on the score, clamped between 50% and 80%.
  // Formula: 50 + (Score - 50) * 0.6. 
  // If Score is 100, Prob is 50 + 30 = 80%.
  // If Score is 50, Prob is 50%.
  const rawProb = 50 + Math.max(0, (analysis.score - 50) * 0.6);
  const probability = Math.min(80, Math.max(50, Math.round(rawProb)));

  // --- Targets & Stop Loss ---
  let targetPrice: number | null = null;
  let stopLoss: number | null = null;

  // Find nearest S/R levels
  const resistances = levels.filter(l => l.type === 'resistance' && l.price > currentPrice).sort((a, b) => a.price - b.price);
  const supports = levels.filter(l => l.type === 'support' && l.price < currentPrice).sort((a, b) => b.price - a.price); // Descending

  if (predictionBias === 'ALCISTA') {
    // Target: First Resistance or ATR multiple
    if (resistances.length > 0) {
      targetPrice = resistances[0].price;
    } else {
      targetPrice = currentPrice + (atr * 2); // Fallback 2xATR
    }

    // Stop Loss: First Support or ATR multiple
    if (supports.length > 0) {
      stopLoss = supports[0].price;
    } else {
      stopLoss = currentPrice - (atr * 1.5); // Fallback 1.5xATR
    }
  } else if (predictionBias === 'BAJISTA') {
    // Target: First Support or ATR multiple
    if (supports.length > 0) {
      targetPrice = supports[0].price;
    } else {
      targetPrice = currentPrice - (atr * 2);
    }

    // Stop Loss: First Resistance or ATR multiple
    if (resistances.length > 0) {
      stopLoss = resistances[0].price;
    } else {
      stopLoss = currentPrice + (atr * 1.5);
    }
  }

  // --- Risk Assessment ---
  // Volatility based risk
  const volatilityPct = (atr / currentPrice) * 100;
  let riskLevel: 'BAJO' | 'MEDIO' | 'ALTO' = 'MEDIO';
  if (volatilityPct > 2) riskLevel = 'ALTO';
  if (volatilityPct < 0.5) riskLevel = 'BAJO';

  // --- Reasoning ---
  const reasoning = [...analysis.reasons];
  if (volatilityPct > 2) reasoning.push("Alta Volatilidad (Riesgo Aumentado)");
  if (targetPrice && stopLoss) {
      const reward = Math.abs(targetPrice - currentPrice);
      const risk = Math.abs(currentPrice - stopLoss);
      if (risk > 0 && (reward / risk) > 1.5) reasoning.push(`Ratio R/B Favorable (> 1.5)`);
  }

  return {
    symbol: analysis.symbol,
    bias: predictionBias,
    entryZone: `$${currentPrice.toFixed(2)}`,
    targetPrice,
    stopLoss,
    probability,
    reasoning: reasoning.slice(0, 4), // Limit to top 4 reasons
    riskLevel,
    timestamp: Date.now()
  };
};