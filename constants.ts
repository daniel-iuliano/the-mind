import { Timeframe } from "./types";

export const APP_NAME = "QuantMind";
export const COINEX_BASE_URL = "https://api.coinex.com/v1";

// Pairs to scan (simulating a watchlist to avoid API rate limits)
// Updated MATIC -> POL following migration
export const WATCHLIST = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", 
  "DOGEUSDT", "ADAUSDT", "POLUSDT", "LTCUSDT",
  "DOTUSDT", "AVAXUSDT", "LINKUSDT", "UNIUSDT"
];

export const DEFAULT_TIMEFRAME = Timeframe.H1;

// Scoring Weights
export const SCORING = {
  RSI_WEIGHT: 20,
  MACD_WEIGHT: 25,
  TREND_WEIGHT: 30, // EMA alignment
  VOLUME_WEIGHT: 15,
  VOLATILITY_WEIGHT: 10,
  THRESHOLD_STRONG: 75,
  THRESHOLD_WEAK: 30,
};