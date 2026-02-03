import { OHLCV, Timeframe } from "../types";
import { COINEX_BASE_URL } from "../constants";

// Helper to prevent rate limiting (politeness delay)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// CORS Proxy is required for browser-based requests to CoinEx public API
const CORS_PROXY = "https://corsproxy.io/?";

// Generate CoinEx Trading URL
export const getExchangeUrl = (symbol: string): string => {
  // CoinEx symbols are usually like BTCUSDT. The URL requires BTC-USDT.
  // We assume all pairs in our watchlist end in USDT for this demo.
  let formatted = symbol;
  if (symbol.endsWith('USDT')) {
    const base = symbol.replace('USDT', '');
    formatted = `${base}-USDT`;
  }
  return `https://www.coinex.com/exchange/${formatted}`;
};

// Fetch snapshot of all tickers to determine top volume pairs
export const fetchTop30Markets = async (): Promise<string[]> => {
  const targetUrl = `${COINEX_BASE_URL}/market/ticker/all`;
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

  try {
    const response = await fetch(proxiedUrl);
    if (!response.ok) throw new Error("Failed to fetch market list");
    const json = await response.json();
    
    if (json.code !== 0 || !json.data || !json.data.ticker) return [];

    const tickers = json.data.ticker;
    
    // Filter for USDT pairs and sort by volume (converted to USD typically approx by quote volume)
    // CoinEx 'vol' is usually the Asset volume, 'buy_amount'/'open' etc might be needed.
    // Actually CoinEx ticker data has: { vol: "asset volume", ... }
    // To be safe for "Trading Pairs", we usually look for USDT.
    
    const entries = Object.entries(tickers)
      .filter(([symbol, _]: [string, any]) => symbol.endsWith('USDT'))
      .map(([symbol, data]: [string, any]) => ({
        symbol,
        volume: parseFloat(data.vol) * parseFloat(data.last) // Approx USD Volume
      }))
      .sort((a, b) => b.volume - a.volume) // Descending
      .slice(0, 30); // Top 30

    return entries.map(e => e.symbol);

  } catch (e) {
    console.warn("Error fetching top markets, using fallback.", e);
    return [];
  }
};

export const fetchTicker = async (symbol: string): Promise<{ last: number, vol: number, change: number } | null> => {
    const targetUrl = `${COINEX_BASE_URL}/market/ticker?market=${symbol}`;
    const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

    try {
        const response = await fetch(proxiedUrl);
        const json = await response.json();
        
        if (json.code !== 0 || !json.data || !json.data.ticker) return null;
        
        const t = json.data.ticker;
        // Calculate change percentage roughly if not provided, usually 'open' is 24h open
        // CoinEx Ticker: last, open, high, low, vol, buy, sell
        const last = parseFloat(t.last);
        const open = parseFloat(t.open);
        const change = open ? ((last - open) / open) * 100 : 0;
        
        return {
            last,
            vol: parseFloat(t.vol), // Asset volume, handled in App usually
            change
        };
    } catch (e) {
        return null;
    }
}

export const fetchCandles = async (symbol: string, timeframe: Timeframe): Promise<OHLCV[]> => {
  // Construct the URL for CoinEx Public API
  // Added limit=100 to ensure we have enough data for indicators but not too much to overload
  const targetUrl = `${COINEX_BASE_URL}/market/kline?market=${symbol}&type=${timeframe}&limit=100`;
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(targetUrl)}`;

  try {
    const response = await fetch(proxiedUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      if (response.status === 400) {
         throw new Error(`Invalid Symbol or Bad Request (${symbol})`);
      }
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    
    const json = await response.json();

    // Validate CoinEx Response
    if (json.code !== 0) {
      throw new Error(`CoinEx API Error: ${json.message || 'Unknown error'}`);
    }

    if (!json.data || !Array.isArray(json.data)) {
      throw new Error("Invalid data format received from CoinEx");
    }

    // CoinEx Data Format: [Time(sec), Open, Close, High, Low, Volume, Amount]
    const candles: OHLCV[] = json.data.map((k: any) => ({
      time: typeof k[0] === 'number' ? k[0] * 1000 : parseInt(k[0]) * 1000,
      open: parseFloat(k[1]),
      close: parseFloat(k[2]),
      high: parseFloat(k[3]),
      low: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    // Sort by time ascending to ensure correct TA calculation
    return candles.sort((a, b) => a.time - b.time);

  } catch (e) {
    // Only log critical errors for things that aren't just missing symbols
    if (e instanceof Error && !e.message.includes('Invalid Symbol')) {
        console.warn(`Failed to fetch REAL data for ${symbol}: ${e.message}`);
    } else {
        console.warn(`Skipping invalid symbol: ${symbol}`);
    }
    // Re-throw so the app knows this fetch failed
    throw e; 
  }
};