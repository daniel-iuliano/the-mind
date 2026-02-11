import { EarlySignal, MarketAnalysis, PredictionResult, SignalBias } from "../types";

const SIGNAL_OPPOSITE: Record<SignalBias, SignalBias> = {
  [SignalBias.STRONG_BUY]: SignalBias.STRONG_SELL,
  [SignalBias.BUY]: SignalBias.SELL,
  [SignalBias.NEUTRAL]: SignalBias.NEUTRAL,
  [SignalBias.SELL]: SignalBias.BUY,
  [SignalBias.STRONG_SELL]: SignalBias.STRONG_BUY,
};

const REASON_OPPOSITES: Record<string, string> = {
  RSI_OVERSOLD: "RSI_OVERBOUGHT",
  RSI_OVERBOUGHT: "RSI_OVERSOLD",
  STOCH_BULL_CROSS: "STOCH_BEAR_CROSS",
  STOCH_BEAR_CROSS: "STOCH_BULL_CROSS",
  EMA_ALIGN_BULL: "EMA_ALIGN_BEAR",
  EMA_ALIGN_BEAR: "EMA_ALIGN_BULL",
  MACD_HIST_BULL: "MACD_HIST_BEAR",
  MACD_HIST_BEAR: "MACD_HIST_BULL",
  BB_BOUNCE_LOW: "BB_REJECT_HIGH",
  BB_REJECT_HIGH: "BB_BOUNCE_LOW",
  PRICE_MOMENTUM_BULL: "PRICE_MOMENTUM_BEAR",
  PRICE_MOMENTUM_BEAR: "PRICE_MOMENTUM_BULL",
  BULL_TRAP_RISK: "BEAR_TRAP_RISK",
  BEAR_TRAP_RISK: "BULL_TRAP_RISK",
  VOL_CONFIRMATION: "VOL_PRESSURE",
  VOL_PRESSURE: "VOL_CONFIRMATION",
  SIGNAL_STACK_BULL: "SIGNAL_STACK_BEAR",
  SIGNAL_STACK_BEAR: "SIGNAL_STACK_BULL",
  EARLY_EMA_BULL: "EARLY_EMA_BEAR",
  EARLY_EMA_BEAR: "EARLY_EMA_BULL",
  EARLY_MACD_BULL: "EARLY_MACD_BEAR",
  EARLY_MACD_BEAR: "EARLY_MACD_BULL",
  EARLY_STOCH_BULL: "EARLY_STOCH_BEAR",
  EARLY_STOCH_BEAR: "EARLY_STOCH_BULL",
  EARLY_RSI_BULL: "EARLY_RSI_BEAR",
  EARLY_RSI_BEAR: "EARLY_RSI_BULL",
  EARLY_BB_BULL: "EARLY_BB_BEAR",
  EARLY_BB_BEAR: "EARLY_BB_BULL",
};

const invertReason = (reason: string) => REASON_OPPOSITES[reason] ?? reason;

const invertEarlySignal = (earlySignal: EarlySignal): EarlySignal => {
  const invertedSide =
    earlySignal.side === "LONG" ? "SHORT" : earlySignal.side === "SHORT" ? "LONG" : "NEUTRAL";
  return {
    ...earlySignal,
    side: invertedSide,
    reasons: earlySignal.reasons.map(invertReason),
  };
};

export const invertMarketAnalysis = (analysis: MarketAnalysis): MarketAnalysis => ({
  ...analysis,
  marketCondition:
    analysis.marketCondition === 'BULLISH'
      ? 'BEARISH'
      : analysis.marketCondition === 'BEARISH'
        ? 'BULLISH'
        : 'NEUTRAL',
  score: analysis.score,
  conditionStrength: analysis.conditionStrength,
  bias: SIGNAL_OPPOSITE[analysis.bias],
  reasons: analysis.reasons.map(invertReason),
  earlySignal: invertEarlySignal(analysis.earlySignal),
});

export const invertPrediction = (prediction: PredictionResult): PredictionResult => {
  const invertedBias =
    prediction.bias === "ALCISTA"
      ? "BAJISTA"
      : prediction.bias === "BAJISTA"
        ? "ALCISTA"
        : "NEUTRAL";

  return {
    ...prediction,
    bias: invertedBias,
    targetPrice: prediction.stopLoss,
    stopLoss: prediction.targetPrice,
  };
};
