export enum Timeframe {
  M1 = '1min',
  M5 = '5min',
  M15 = '15min',
  H1 = '1hour',
  H4 = '4hour',
  D1 = '1day',
}

export enum SignalBias {
  STRONG_BUY = 'STRONG_BUY',
  BUY = 'BUY',
  NEUTRAL = 'NEUTRAL',
  SELL = 'SELL',
  STRONG_SELL = 'STRONG_SELL',
}

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // How many times it was tested
}

export interface IndicatorValues {
  rsi: number;
  stochRsi: {
    k: number;
    d: number;
  };
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  ema20: number;
  ema50: number;
  ema200: number;
  bb: {
    upper: number;
    lower: number;
    middle: number;
  };
  atr: number;
}

export interface MarketAnalysis {
  symbol: string;
  price: number;
  change24h: number; // Calculated from open of last 24h candle
  volume24h: number;
  indicators: IndicatorValues;
  score: number; // 0 to 100
  bias: SignalBias;
  reasons: string[];
  timestamp: number;
}

export interface Alert {
  id: string;
  symbol: string;
  bias: SignalBias;
  score: number;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface AlertConfig {
  enabled: boolean;
  predictMode: boolean; // Enables probabilistic prediction reports in alerts
  telegramToken: string;
  telegramChatId: string;
  scope: 'ALL' | 'SELECTED'; // Selected means items in watchlist (currently all items) vs specific (not fully implemented so defaulting to logic that applies filters)
  selectedPairs: string[]; // For future specific pair filtering
  signals: {
    buy: boolean;
    sell: boolean;
  };
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH'; // Low = High Score Threshold, High = Low Threshold
  throttleMinutes: number;
  events: {
    highScore: boolean;
    volumeSpike: boolean;
    trendBreak: boolean;
  };
}

export interface PredictionResult {
  symbol: string;
  bias: 'ALCISTA' | 'BAJISTA' | 'NEUTRAL';
  entryZone: string;
  targetPrice: number | null;
  stopLoss: number | null;
  probability: number; // 0-100
  reasoning: string[];
  riskLevel: 'BAJO' | 'MEDIO' | 'ALTO';
  timestamp: number;
}