import { OHLCV, Timeframe } from "../types";

const COINEX_PROXY_PATH = "/api/coinex";

const buildProxyUrl = (path: string, params?: Record<string, string | number>) => {
  const search = new URLSearchParams({ path });
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      search.set(key, String(value));
    });
  }
  return `${COINEX_PROXY_PATH}?${search.toString()}`;
};

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

// Generate CoinEx App Deep Link
export const getExchangeAppUrl = (symbol: string): string => {
  // CoinEx app expects the market symbol without a dash, e.g., BTCUSDT.
  return `coinex://exchange?market=${symbol}`;
};

// Fetch snapshot of all tickers to determine top volume pairs
export const fetchTop30Markets = async (): Promise<string[]> => {
  const proxiedUrl = buildProxyUrl("/market/ticker/all");

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
    const proxiedUrl = buildProxyUrl("/market/ticker", { market: symbol });

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



export const fetchOrderBookImbalance = async (symbol: string): Promise<number | null> => {
  const proxiedUrl = buildProxyUrl("/market/depth", { market: symbol, merge: 0, limit: 20 });

  try {
    const response = await fetch(proxiedUrl);
    const json = await response.json();
    if (json.code !== 0 || !json.data) return null;

    const bids = Array.isArray(json.data.bids) ? json.data.bids : [];
    const asks = Array.isArray(json.data.asks) ? json.data.asks : [];

    const bidPressure = bids.reduce((sum: number, lvl: any[]) => {
      const price = parseFloat(lvl?.[0] ?? 0);
      const amount = parseFloat(lvl?.[1] ?? 0);
      return sum + (Number.isFinite(price) && Number.isFinite(amount) ? price * amount : 0);
    }, 0);

    const askPressure = asks.reduce((sum: number, lvl: any[]) => {
      const price = parseFloat(lvl?.[0] ?? 0);
      const amount = parseFloat(lvl?.[1] ?? 0);
      return sum + (Number.isFinite(price) && Number.isFinite(amount) ? price * amount : 0);
    }, 0);

    const total = bidPressure + askPressure;
    if (total <= 0) return null;

    return (bidPressure - askPressure) / total;
  } catch {
    return null;
  }
};

export const fetchCandles = async (symbol: string, timeframe: Timeframe): Promise<OHLCV[]> => {
  // Construct the URL for CoinEx Public API
  // Added limit=100 to ensure we have enough data for indicators but not too much to overload
  const proxiedUrl = buildProxyUrl("/market/kline", {
    market: symbol,
    type: timeframe,
    limit: 100,
  });

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


// Optional OI endpoint wrapper (may be unavailable depending on exchange/provider).
export const fetchOpenInterest = async (_symbol: string): Promise<number | null> => {
  // CoinEx public endpoints do not consistently expose perpetual OI in all environments.
  // Keep this optional so institutional modules can gracefully degrade to UNAVAILABLE.
  return null;
};
