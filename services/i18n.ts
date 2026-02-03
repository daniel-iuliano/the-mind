
export type Language = 'ES' | 'EN';

export const TRANSLATIONS = {
  ES: {
    // UI
    HEADER_TITLE: "THE MIND",
    THEME_LIGHT: "Claro",
    THEME_DARK: "Oscuro",
    LIVE: "EN VIVO",
    PAUSE: "PAUSA",
    SCANNING: "ESCANEANDO",
    NO_SIGNALS: "No hay señales",
    NO_SIGNALS_DESC: "El mercado no coincide con tu filtro actual. Probá cambiando de timeframe.",
    
    // Filters
    FILTER_ALL: "TODOS",
    FILTER_BULL: "ALCISTAS",
    FILTER_BEAR: "BAJISTAS",

    // Card
    BULL: "BULL",
    BEAR: "BEAR",

    // Detail
    PREDICT_BTN: "PREDECIR",
    REALTIME: "TIEMPO REAL",
    DRIVERS: "DRIVERS",
    AI_ANALYSIS: "ANÁLISIS IA",
    AI_PROMPT: "Generá un resumen de estructura de mercado.",
    AI_BTN: "GENERAR INTEL",
    AI_UPDATE: "ACTUALIZAR",
    PROCESSING: "PROCESANDO",

    // Grid Stats
    SCORE: "PUNTAJE",
    VOL: "VOL",

    // Modals
    CONFIG_TITLE: "CONFIGURACIÓN",
    PREDICT_TITLE: "MODO PREDICT",
    KEYS_TITLE: "CONECTAR COINEX",
    CONFIRM_TITLE: "CONFIRMAR POSICIÓN",
    CLOSE: "CERRAR",
    CANCEL: "CANCELAR",
    CONFIRM_OPEN: "CONFIRMAR Y ABRIR",

    // Settings
    ACTIVE_ALERTS: "ALERTAS ACTIVAS",
    PREDICT_MODE: "MODO PREDICT",
    PREDICT_DESC: "Reportes probabilísticos en señales fuertes.",
    SECURE_STORAGE: "ALMACENAMIENTO SEGURO",
    SECURE_DESC: "Las claves se guardan localmente en tu navegador.",
    API_KEY: "API KEY",
    API_SECRET: "API SECRET",
    SAVE_KEYS: "GUARDAR CLAVES",
    CLEAR_KEYS: "BORRAR CLAVES COINEX",
    TELEGRAM_CONFIG: "CONFIGURACIÓN TELEGRAM",

    // Predict
    DIRECTION: "DIRECCIÓN",
    CONFIDENCE: "CONFIANZA",
    TARGET: "TARGET",
    STOP_LOSS: "STOP LOSS",
    ALPHA_INTEL: "ALPHA INTEL",
    OPEN_COINEX: "ABRIR EN COINEX",

    // Confirm
    PAIR: "PAR",
    SIDE: "LADO",
    SIDE_LONG: "COMPRA / LONG",
    SIDE_SHORT: "VENTA / SHORT",
    DISCLAIMER: "The Mind no ejecuta operaciones. Serás redirigido a CoinEx para ejecutar manualmente.",

    // Alerts
    ALERT_HEADER: "ALERTA QUANTMIND",
    ALERT_TIMEFRAME: "Timeframe",
    ALERT_SIGNAL: "Señal",
    ALERT_SCORE: "Puntaje",
    ALERT_PRICE: "Precio",
    ALERT_DRIVERS: "Drivers",
    ALERT_PREDICT: "MODO PREDICT",
    ALERT_PROB: "Probabilidad",
    ALERT_OUTLOOK: "Outlook probabilístico. No es consejo financiero.",
  },
  EN: {
    // UI
    HEADER_TITLE: "THE MIND",
    THEME_LIGHT: "Light",
    THEME_DARK: "Dark",
    LIVE: "LIVE",
    PAUSE: "PAUSE",
    SCANNING: "SCANNING",
    NO_SIGNALS: "No signals found",
    NO_SIGNALS_DESC: "Market does not match current filter. Try changing timeframe.",
    
    // Filters
    FILTER_ALL: "ALL ASSETS",
    FILTER_BULL: "BULLISH",
    FILTER_BEAR: "BEARISH",

    // Card
    BULL: "BULL",
    BEAR: "BEAR",

    // Detail
    PREDICT_BTN: "PREDICT",
    REALTIME: "REALTIME",
    DRIVERS: "DRIVERS",
    AI_ANALYSIS: "AI ANALYSIS",
    AI_PROMPT: "Generate market structure summary.",
    AI_BTN: "GENERATE INTEL",
    AI_UPDATE: "UPDATE",
    PROCESSING: "PROCESSING",

    // Grid Stats
    SCORE: "SCORE",
    VOL: "VOL",

    // Modals
    CONFIG_TITLE: "SETTINGS",
    PREDICT_TITLE: "PREDICT MODE",
    KEYS_TITLE: "CONNECT COINEX",
    CONFIRM_TITLE: "CONFIRM POSITION",
    CLOSE: "CLOSE",
    CANCEL: "CANCEL",
    CONFIRM_OPEN: "CONFIRM & OPEN",

    // Settings
    ACTIVE_ALERTS: "ACTIVE ALERTS",
    PREDICT_MODE: "PREDICT MODE",
    PREDICT_DESC: "Probabilistic reports on strong signals.",
    SECURE_STORAGE: "SECURE STORAGE",
    SECURE_DESC: "Keys are stored locally in your browser.",
    API_KEY: "API KEY",
    API_SECRET: "API SECRET",
    SAVE_KEYS: "SAVE KEYS",
    CLEAR_KEYS: "CLEAR COINEX KEYS",
    TELEGRAM_CONFIG: "TELEGRAM CONFIG",

    // Predict
    DIRECTION: "DIRECTION",
    CONFIDENCE: "CONFIDENCE",
    TARGET: "TARGET",
    STOP_LOSS: "STOP LOSS",
    ALPHA_INTEL: "ALPHA INTEL",
    OPEN_COINEX: "OPEN ON COINEX",

    // Confirm
    PAIR: "PAIR",
    SIDE: "SIDE",
    SIDE_LONG: "BUY / LONG",
    SIDE_SHORT: "SELL / SHORT",
    DISCLAIMER: "The Mind does not execute trades. You will be redirected to CoinEx to execute manually.",

    // Alerts
    ALERT_HEADER: "QUANTMIND ALERT",
    ALERT_TIMEFRAME: "Timeframe",
    ALERT_SIGNAL: "Signal",
    ALERT_SCORE: "Score",
    ALERT_PRICE: "Price",
    ALERT_DRIVERS: "Drivers",
    ALERT_PREDICT: "PREDICT MODE",
    ALERT_PROB: "Probability",
    ALERT_OUTLOOK: "Probabilistic outlook. Not financial advice.",
  }
};

export const REASON_CODES: Record<string, { ES: string, EN: string }> = {
  "RSI_OVERSOLD": { ES: "RSI Sobrevendido", EN: "RSI Oversold" },
  "RSI_OVERBOUGHT": { ES: "RSI Sobrecomprado", EN: "RSI Overbought" },
  "STOCH_BULL_CROSS": { ES: "Cruce Alcista StochRSI", EN: "StochRSI Bull Cross" },
  "STOCH_BEAR_CROSS": { ES: "Cruce Bajista StochRSI", EN: "StochRSI Bear Cross" },
  "EMA_ALIGN_BULL": { ES: "Alineación EMAs Alcista", EN: "Bullish EMA Alignment" },
  "EMA_ALIGN_BEAR": { ES: "Alineación EMAs Bajista", EN: "Bearish EMA Alignment" },
  "MACD_HIST_BULL": { ES: "MACD Creciendo", EN: "MACD Growing" },
  "MACD_HIST_BEAR": { ES: "MACD Decreciendo", EN: "MACD Shrinking" },
  "BB_BOUNCE_LOW": { ES: "Rebote Banda Inferior", EN: "Lower BB Bounce" },
  "BB_REJECT_HIGH": { ES: "Rechazo Banda Superior", EN: "Upper BB Rejection" },
  "LOW_VOLATILITY": { ES: "Baja Volatilidad", EN: "Low Volatility" },
  "VOL_CONFIRMATION": { ES: "Confirmación Volumen", EN: "Volume Confirmation" },
  "VOL_PRESSURE": { ES: "Presión de Venta", EN: "Sell Pressure" },
  "HIGH_VOL_RISK": { ES: "Alta Volatilidad (Riesgo)", EN: "High Volatility (Risk)" },
  "RR_FAVORABLE": { ES: "Ratio R/B Favorable", EN: "Favorable R/R Ratio" }
};

export const translateReason = (code: string, lang: Language): string => {
  if (REASON_CODES[code]) {
    return REASON_CODES[code][lang];
  }
  return code; // Fallback if regular text
};
