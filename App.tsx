import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchCandles, fetchTop30Markets, fetchTicker } from './services/coinex';
import { analyzeCandles, calculateSupportResistance } from './services/indicators';
import { scoreMarket } from './services/analyzer';
import { generateAIAnalysis } from './services/geminiService';
import { generatePrediction } from './services/predictor';
import { sendTelegramMessage, formatAlertMessage, shouldSendAlert } from './services/telegram';
import { WATCHLIST, DEFAULT_TIMEFRAME } from './constants';
import { MarketAnalysis, OHLCV, Timeframe, SupportResistanceLevel, AlertConfig, PredictionResult } from './types';
import Chart from './components/Chart';

// --- Icons & Assets ---
const MoonIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
const SunIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const BellIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
const PredictIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
const CloseIcon = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>;

// --- BRAIN LOADER COMPONENT (THE MIND IDENTITY) ---
interface BrainLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

const BrainLoader: React.FC<BrainLoaderProps> = ({ size = 'md', className = '', label }) => {
  const dims = {
    sm: "w-6 h-6",
    md: "w-10 h-10",
    lg: "w-24 h-24",
    xl: "w-40 h-40"
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className} select-none pointer-events-none`}>
        <div className={`relative ${dims[size]}`}>
            {/* Pulsating Brain */}
            <svg 
                viewBox="0 0 100 100" 
                className="w-full h-full text-street-acid dark:text-street-acid text-street-purple animate-heartbeat drop-shadow-glow"
                fill="currentColor"
            >
                {/* Brain Shape */}
                <path d="M20,50 C20,25 35,10 50,10 C65,10 80,25 80,50 C80,60 75,70 65,75 L60,85 C60,85 40,85 40,85 L35,75 C25,70 20,60 20,50 Z" opacity="0.9"/>
                {/* Circuit/Lobe Details */}
                <path d="M50,15 L50,85 M35,25 C35,25 65,25 65,25 M30,50 L70,50 M40,65 L60,65" stroke="rgba(0,0,0,0.2)" strokeWidth="3" fill="none" strokeLinecap="round"/>
            </svg>
            
            {/* Electric Rays (Sparks) */}
            <svg className="absolute inset-0 w-full h-full animate-lightning pointer-events-none text-white mix-blend-overlay" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
                 <path d="M10,40 L20,45" opacity="0.8" />
                 <path d="M90,40 L80,45" opacity="0.8" />
                 <path d="M50,5 L50,15" opacity="0.8" />
                 <path d="M15,15 L25,25" opacity="0.8" />
                 <path d="M85,15 L75,25" opacity="0.8" />
                 <path d="M30,80 L35,90" opacity="0.5" />
                 <path d="M70,80 L65,90" opacity="0.5" />
            </svg>
        </div>
        {label && <span className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] animate-pulse opacity-80 text-street-dark dark:text-street-light">{label}</span>}
    </div>
  );
};

// --- GLOBAL FULLSCREEN LOADER ---
const GlobalInteractionLoader = ({ visible }: { visible: boolean }) => {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-street-light/80 dark:bg-street-dark/95 backdrop-blur-sm animate-in fade-in duration-200">
        <BrainLoader size="xl" label="THINKING" />
    </div>
  );
};

// --- Helper Components ---

const PriceDisplay = ({ price }: { price: number }) => {
  const [prevPrice, setPrevPrice] = useState(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price > prevPrice) setFlash('up');
    else if (price < prevPrice) setFlash('down');
    setPrevPrice(price);
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [price]);

  return (
    <span className={`font-mono font-bold transition-all duration-300 ${
      flash === 'up' ? 'text-green-600 dark:text-street-acid scale-110 inline-block' : 
      flash === 'down' ? 'text-pink-600 dark:text-street-pink scale-110 inline-block' : 'text-inherit'
    }`}>
      ${price < 1 ? price.toFixed(5) : price.toFixed(2)}
    </span>
  );
};

const StreetBadge = ({ text, type }: { text: string, type: 'bull' | 'bear' | 'neutral' }) => {
  const colors = {
    bull: 'bg-street-acid text-black border-black',
    bear: 'bg-street-pink text-white border-black',
    neutral: 'bg-gray-300 text-gray-800 border-black'
  };
  return (
    <span className={`${colors[type]} px-2 py-0.5 text-[10px] font-bold uppercase border-2 shadow-brutal-sm transform -rotate-1`}>
      {text}
    </span>
  );
};

const MarketCard = ({ data, onClick, isLoading }: { data: MarketAnalysis, onClick: () => void, isLoading: boolean }) => {
  const isBull = data.bias.includes('BUY');
  const isBear = data.bias.includes('SELL');

  return (
    <div 
      onClick={onClick}
      className="group bg-street-cardLight dark:bg-street-cardDark rounded-xl p-4 mb-3 border-2 border-black dark:border-white shadow-brutal active:shadow-none active:translate-x-[4px] active:translate-y-[4px] transition-all cursor-pointer relative overflow-hidden"
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-extrabold italic tracking-tight">{data.symbol}</h3>
            {isLoading && <BrainLoader size="sm" />}
          </div>
          <div className="flex items-center gap-3 text-xs font-bold text-gray-600 dark:text-gray-400">
             <PriceDisplay price={data.price} />
             <span className={`${data.change24h >= 0 ? 'text-green-600 dark:text-street-acid' : 'text-pink-600 dark:text-street-pink'}`}>
               {data.change24h > 0 ? '▲' : '▼'} {Math.abs(data.change24h).toFixed(2)}%
             </span>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
            <div className={`w-8 h-8 flex items-center justify-center rounded-full border-2 border-black dark:border-white font-extrabold text-xs ${
                data.score >= 70 ? 'bg-street-acid text-black' : 
                data.score <= 30 ? 'bg-street-pink text-white' : 'bg-gray-200 text-gray-800'
            }`}>
                {Math.round(data.score)}
            </div>
            {isBull && <StreetBadge text="BULL" type="bull" />}
            {isBear && <StreetBadge text="BEAR" type="bear" />}
        </div>
      </div>
      
      {/* Mini Volume Bar */}
      <div className="mt-3 w-full h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden border border-black dark:border-white">
          <div 
            className={`h-full ${isBull ? 'bg-street-acid' : 'bg-street-pink'}`} 
            style={{ width: `${Math.min(data.score, 100)}%` }}
          />
      </div>
    </div>
  );
};

// --- Modals ---

const ModalWrapper = ({ isOpen, onClose, title, children, color = "border-black dark:border-white" }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full sm:max-w-md bg-street-cardLight dark:bg-street-cardDark border-t-4 sm:border-4 ${color} shadow-brutal-white sm:shadow-brutal sm:rounded-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[90vh]`}>
                <div className="flex justify-between items-center p-4 border-b-2 border-inherit bg-street-light dark:bg-black/20">
                    <h2 className="text-lg font-bold uppercase tracking-tight italic flex items-center gap-2">
                        {title}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-black/10 rounded active:scale-90 transition-transform">
                        <CloseIcon />
                    </button>
                </div>
                <div className="overflow-y-auto p-4 sm:p-6">
                    {children}
                </div>
            </div>
        </div>
    );
};

const PredictionContent = ({ result, onClose }: { result: PredictionResult, onClose: () => void }) => {
    const isBull = result.bias === 'ALCISTA';
    const accentColor = isBull 
        ? 'text-green-600 dark:text-street-acid' 
        : result.bias === 'BAJISTA' 
            ? 'text-pink-600 dark:text-street-pink' 
            : 'text-gray-600 dark:text-gray-400';
    
    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Dirección</span>
                    <span className={`text-3xl font-extrabold italic tracking-tighter ${accentColor}`}>{result.bias}</span>
                </div>
                <div className="text-right">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Confianza</span>
                    <div className="text-3xl font-extrabold">{result.probability}%</div>
                </div>
            </div>

            <div className="p-4 border-2 border-black dark:border-white bg-street-light dark:bg-black/40 rounded-xl relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${isBull ? 'bg-street-acid' : 'bg-street-pink'}`}></div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                         <div className="text-xs font-bold uppercase mb-1 text-gray-600 dark:text-gray-300">Target</div>
                         <div className="text-lg font-mono font-bold text-green-700 dark:text-street-acid">
                             {result.targetPrice ? `$${result.targetPrice.toFixed(result.targetPrice < 1 ? 5 : 2)}` : '---'}
                         </div>
                    </div>
                    <div>
                         <div className="text-xs font-bold uppercase mb-1 text-gray-600 dark:text-gray-300">Stop Loss</div>
                         <div className="text-lg font-mono font-bold text-pink-700 dark:text-street-pink">
                             {result.stopLoss ? `$${result.stopLoss.toFixed(result.stopLoss < 1 ? 5 : 2)}` : '---'}
                         </div>
                    </div>
                </div>
            </div>

            <div>
                <h3 className="text-sm font-bold uppercase border-b-2 border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-2">Alpha Intel</h3>
                <ul className="space-y-2">
                    {result.reasoning.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                            <span className="text-green-600 dark:text-street-acid">➜</span>
                            {r}
                        </li>
                    ))}
                </ul>
            </div>

            <button 
                onClick={onClose}
                className="w-full py-3 bg-street-dark dark:bg-street-light text-street-light dark:text-street-dark font-extrabold text-sm uppercase tracking-widest border-2 border-transparent active:scale-[0.98] transition-all"
            >
                CERRAR
            </button>
        </div>
    );
};

const SettingsContent = ({ config, setConfig }: any) => {
    return (
        <div className="space-y-6">
             <div className="flex items-center justify-between p-4 border-2 border-black dark:border-white rounded-xl bg-street-light dark:bg-black/20">
                <span className="font-bold text-sm uppercase text-gray-800 dark:text-white">Alertas Activas</span>
                <button 
                    onClick={() => setConfig({...config, enabled: !config.enabled})}
                    className={`w-14 h-8 rounded-full border-2 border-black dark:border-white transition-colors relative ${config.enabled ? 'bg-street-acid' : 'bg-gray-400'}`}
                >
                    <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-black border border-white transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>

            <div className="p-4 border-2 border-street-purple/50 bg-street-purple/10 rounded-xl relative overflow-hidden">
                <div className="absolute -right-4 -top-4 text-6xl opacity-20">🔮</div>
                <div className="flex items-center justify-between relative z-10">
                    <div>
                        <span className="font-bold text-sm uppercase text-street-purple block">Modo Predict</span>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 max-w-[150px] block leading-tight mt-1">
                            Reportes probabilísticos en señales fuertes.
                        </span>
                    </div>
                    <button 
                        onClick={() => setConfig({...config, predictMode: !config.predictMode})}
                        className={`w-14 h-8 rounded-full border-2 border-black dark:border-white transition-colors relative ${config.predictMode ? 'bg-street-purple' : 'bg-gray-400'}`}
                    >
                        <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-black border border-white transition-transform ${config.predictMode ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">Configuración Telegram</h3>
                <input 
                    type="text" 
                    placeholder="BOT TOKEN" 
                    value={config.telegramToken}
                    onChange={(e) => setConfig({...config, telegramToken: e.target.value})}
                    className="w-full bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid placeholder-gray-500 text-street-dark dark:text-street-light"
                />
                <input 
                    type="text" 
                    placeholder="CHAT ID" 
                    value={config.telegramChatId}
                    onChange={(e) => setConfig({...config, telegramChatId: e.target.value})}
                    className="w-full bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid placeholder-gray-500 text-street-dark dark:text-street-light"
                />
            </div>
        </div>
    );
}

// --- Main App ---

export default function App() {
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // App Data States
  const [marketData, setMarketData] = useState<MarketAnalysis[]>([]);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [dynamicWatchlist, setDynamicWatchlist] = useState<string[]>(WATCHLIST);
  const [isWatchlistLoaded, setIsWatchlistLoaded] = useState(false);
  
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [isScanning, setIsScanning] = useState(true);
  
  // Detail & Modals
  const [chartData, setChartData] = useState<(OHLCV & { ema20?: number, ema50?: number })[]>([]);
  const [srLevels, setSrLevels] = useState<SupportResistanceLevel[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [isPredictionModalOpen, setIsPredictionModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // GLOBAL LOADER STATE
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);

  // Config State
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('quantmind_alert_config') : null;
    return saved ? JSON.parse(saved) : {
        enabled: false,
        predictMode: false,
        telegramToken: '',
        telegramChatId: '',
        scope: 'ALL',
        selectedPairs: [],
        signals: { buy: true, sell: true },
        sensitivity: 'MEDIUM',
        throttleMinutes: 60,
        events: { highScore: true, volumeSpike: true, trendBreak: true }
    };
  });
  
  const lastAlertsRef = useRef<Map<string, number>>(new Map());

  // --- Effects ---

  // Theme Init & Toggle
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'dark' | 'light' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('quantmind_alert_config', JSON.stringify(alertConfig));
  }, [alertConfig]);

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

  // --- GLOBAL LOADER WRAPPER ---
  // Wraps an async action. Displays loader.
  // Enforces max 2s visibility. If action finishes faster, loader hides.
  // If action takes longer, loader hides at 2s (background loading).
  const withLoader = async (fn: () => void | Promise<any>) => {
    setIsGlobalLoading(true);
    const maxTime = new Promise((resolve) => setTimeout(resolve, 2000));
    const action = async () => { await fn(); };
    
    // Race: Whichever finishes first triggers logic
    // But we actually want the loader to hide EITHER when action finishes OR at 2s.
    await Promise.race([action(), maxTime]);
    setIsGlobalLoading(false);
  };

  // --- Data Logic ---

  useEffect(() => {
    const initMarket = async () => {
      try {
        const topPairs = await fetchTop30Markets();
        if (topPairs.length > 0) setDynamicWatchlist(topPairs);
      } catch (e) { console.warn("Fallback WL"); } finally { setIsWatchlistLoaded(true); }
    };
    initMarket();
  }, []);

  // Fetch Chart Data
  const loadDetailData = async (symbol: string, tf: Timeframe) => {
    setChartData([]); setSrLevels([]); setAiAnalysis(""); 
    try {
        const candles = await fetchCandles(symbol, tf);
        if (!candles || candles.length < 50) return;
        const chartWithIndicators = candles.map((c, i) => ({
            ...c,
            ema20: i > 20 ? analyzeCandles(candles.slice(0, i+1)).ema20 : undefined,
            ema50: i > 50 ? analyzeCandles(candles.slice(0, i+1)).ema50 : undefined,
        })).slice(-80); 
        setChartData(chartWithIndicators);
        setSrLevels(calculateSupportResistance(candles));
    } catch (e) { console.error(e); }
  };

  // Interaction Handlers (Wrapped with Global Loader)
  const handleSymbolSelect = (symbol: string) => {
      if (symbol === selectedSymbol) return;
      withLoader(async () => {
          setSelectedSymbol(symbol);
          await loadDetailData(symbol, activeTimeframe);
      });
  };

  const handleTimeframeChange = (tf: Timeframe) => {
      if (tf === activeTimeframe) return;
      withLoader(async () => {
          setActiveTimeframe(tf);
          setMarketData([]); // Clear scanner list to show fresh state
          if (selectedSymbol) {
              await loadDetailData(selectedSymbol, tf);
          }
      });
  };

  const handlePredict = () => {
      if (!selectedSymbol) return;
      const analysis = marketData.find(m => m.symbol === selectedSymbol);
      if (!analysis) return;
      
      withLoader(async () => {
          // Fake delay for "Thinking" feel if calculation is too fast
          await wait(600); 
          const result = generatePrediction(analysis, srLevels);
          setPredictionResult(result);
          setIsPredictionModalOpen(true);
      });
  };

  const handleAI = async () => {
    if (!selectedSymbol) return;
    const analysis = marketData.find(m => m.symbol === selectedSymbol);
    if (!analysis) return;

    if (typeof window !== 'undefined' && (window as any).aistudio) {
        try {
            const hasKey = await (window as any).aistudio.hasSelectedApiKey();
            if (!hasKey) await (window as any).aistudio.openSelectKey();
        } catch (e) { return; }
    }

    setIsAnalyzing(true);
    withLoader(async () => {
        try {
            const res = await generateAIAnalysis(analysis);
            setAiAnalysis(res);
        } catch (e: any) {
            setAiAnalysis(e.message || "Error");
        } finally { setIsAnalyzing(false); }
    });
  };

  const toggleSettings = () => {
      withLoader(() => {
          setIsSettingsOpen(!isSettingsOpen);
      });
  };

  const toggleTheme = () => {
      withLoader(() => {
          setTheme(theme === 'dark' ? 'light' : 'dark');
      });
  };
  
  const toggleScanning = () => {
      withLoader(() => {
          setIsScanning(!isScanning);
      });
  };

  // Scan Logic
  const runScan = useCallback(async () => {
    if (!isScanning || !isWatchlistLoaded) return;
    for (const symbol of dynamicWatchlist) {
      if (!isScanning) break;
      setLoadingMap(prev => ({ ...prev, [symbol]: true }));
      try {
        const [candles, ticker] = await Promise.all([
             fetchCandles(symbol, activeTimeframe).catch(e => null),
             fetchTicker(symbol).catch(e => null)
        ]);
        
        if (!candles || candles.length < 50) continue;

        const indicators = analyzeCandles(candles);
        const livePrice = ticker ? ticker.last : candles[candles.length - 1].close;
        const liveVolume = ticker ? ticker.vol : candles[candles.length - 1].volume;
        const prevCandle = candles[candles.length - 2];
        const prevVolume = prevCandle.volume; 
        const open24h = candles[candles.length - Math.min(24, candles.length)]?.open || livePrice;
        const changeVal = ticker ? ticker.change : ((livePrice - open24h) / open24h) * 100;
        const analysis = scoreMarket(symbol, livePrice, indicators, liveVolume, prevVolume, changeVal);

        setMarketData(prevData => {
            const filtered = prevData.filter(d => d.symbol !== symbol);
            const updated = [...filtered, analysis];
            return updated.sort((a, b) => b.score - a.score);
        });

        const lastAlertTime = lastAlertsRef.current.get(symbol) || 0;
        if (shouldSendAlert(analysis, alertConfig, lastAlertTime)) {
            let prediction: PredictionResult | null = null;
            if (alertConfig.predictMode && analysis.score >= 75) {
                const levels = calculateSupportResistance(candles);
                prediction = generatePrediction(analysis, levels);
            }
            const msg = formatAlertMessage(analysis, activeTimeframe, prediction);
            await sendTelegramMessage(alertConfig.telegramToken, alertConfig.telegramChatId, msg);
            lastAlertsRef.current.set(symbol, Date.now());
        }
      } catch (err) { /* quiet fail */ } finally {
        setLoadingMap(prev => ({ ...prev, [symbol]: false }));
      }
      await wait(200); 
    }
  }, [isScanning, activeTimeframe, alertConfig, dynamicWatchlist, isWatchlistLoaded]);

  useEffect(() => {
    runScan();
    const interval = setInterval(runScan, 10000); 
    return () => clearInterval(interval);
  }, [runScan]);

  const activeMarket = marketData.find(m => m.symbol === selectedSymbol);

  // --- RENDER ---

  return (
    <div className="min-h-screen pb-safe transition-colors duration-300">
      
      <GlobalInteractionLoader visible={isGlobalLoading} />

      {/* 1. MAIN SCANNER VIEW */}
      <div className={`transition-all duration-300 ${selectedSymbol ? 'opacity-0 pointer-events-none hidden' : 'opacity-100'}`}>
        
        {/* HEADER */}
        <header className="sticky top-0 z-40 bg-street-light/90 dark:bg-street-dark/90 backdrop-blur border-b-2 border-black dark:border-white px-4 py-3">
           <div className="flex justify-between items-center mb-3">
              <h1 className="font-extrabold text-xl tracking-tighter italic flex items-center gap-2">
                 THE<span className="text-street-acid">MIND</span>
                 <BrainLoader size="sm" />
              </h1>
              <div className="flex items-center gap-3">
                  <button onClick={toggleTheme} className="p-2 border-2 border-transparent hover:border-black dark:hover:border-white rounded-lg transition-all">
                      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                  </button>
                  <button onClick={toggleSettings} className={`p-2 border-2 border-black dark:border-white rounded-lg shadow-brutal-sm active:shadow-none active:translate-y-1 transition-all ${alertConfig.enabled ? 'bg-street-acid text-black' : 'bg-transparent'}`}>
                     <BellIcon />
                  </button>
                  <button 
                    onClick={toggleScanning}
                    className={`text-[10px] font-bold px-2 py-2 rounded-lg border-2 border-black dark:border-white shadow-brutal-sm active:shadow-none active:translate-y-1 transition-all ${isScanning ? 'bg-street-acid text-black' : 'bg-street-pink text-white'}`}
                  >
                     {isScanning ? 'LIVE' : 'PAUSE'}
                  </button>
              </div>
           </div>

           {/* TIMEFRAME SELECTOR */}
           <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {[Timeframe.M5, Timeframe.M15, Timeframe.H1, Timeframe.H4].map(tf => (
                 <button 
                    key={tf}
                    onClick={() => handleTimeframeChange(tf)}
                    className={`whitespace-nowrap px-4 py-1 rounded-lg text-xs font-bold border-2 border-black dark:border-white transition-all ${
                        activeTimeframe === tf 
                        ? 'bg-black text-white dark:bg-white dark:text-black shadow-brutal-sm' 
                        : 'bg-transparent text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white'
                    }`}
                 >
                    {tf}
                 </button>
              ))}
           </div>
        </header>

        {/* FEED */}
        <main className="p-4 pb-20 space-y-2 min-h-screen">
           {marketData.length === 0 && isScanning && (
               <div className="flex flex-col items-center justify-center py-24 opacity-80 animate-in fade-in">
                   <BrainLoader size="xl" label="ESCANEANDO" />
               </div>
           )}
           {marketData.map(item => (
              <MarketCard 
                 key={item.symbol} 
                 data={item} 
                 isLoading={!!loadingMap[item.symbol]}
                 onClick={() => handleSymbolSelect(item.symbol)} 
              />
           ))}
           <div className="h-12"></div>
        </main>
      </div>

      {/* 2. DETAIL VIEW OVERLAY */}
      {selectedSymbol && activeMarket && (
         <div className="fixed inset-0 z-50 bg-street-light dark:bg-street-dark flex flex-col animate-in slide-in-from-right duration-300">
            {/* DETAIL HEADER */}
            <div className="flex items-center justify-between p-4 border-b-2 border-black dark:border-white">
               <button onClick={() => setSelectedSymbol(null)} className="p-2 -ml-2 hover:bg-black/10 rounded-full">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
               </button>
               <div className="text-center">
                  <h2 className="font-extrabold text-xl italic tracking-tighter leading-none">{selectedSymbol}</h2>
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">{activeTimeframe} • REALTIME</span>
               </div>
               <button 
                  onClick={handlePredict}
                  disabled={!!loadingMap[selectedSymbol]}
                  className="bg-street-purple text-white border-2 border-black dark:border-white shadow-brutal-sm px-3 py-2 rounded-lg flex items-center gap-1 active:shadow-none active:translate-y-1 transition-all"
               >
                  <PredictIcon />
                  <span className="text-xs font-bold">PREDICT</span>
               </button>
            </div>

            {/* DETAIL CONTENT */}
            <div className="flex-1 overflow-y-auto bg-street-light dark:bg-street-dark">
               <div className="h-[350px] w-full border-b-2 border-black dark:border-white bg-white/5 relative">
                  <Chart data={chartData} symbol={selectedSymbol} levels={srLevels} theme={theme} />
               </div>

               {/* GRID STATS */}
               <div className="grid grid-cols-3 gap-3 p-4">
                  {[
                      { l: 'RSI', v: activeMarket.indicators.rsi.toFixed(0), c: activeMarket.indicators.rsi > 70 ? 'text-pink-600 dark:text-street-pink' : activeMarket.indicators.rsi < 30 ? 'text-green-600 dark:text-street-acid' : '' },
                      { l: 'SCORE', v: Math.round(activeMarket.score), c: 'text-street-cyan' },
                      { l: 'VOL', v: `${(activeMarket.volume24h / 1000).toFixed(0)}k`, c: '' }
                  ].map((s, i) => (
                      <div key={i} className="bg-street-cardLight dark:bg-street-cardDark p-2 rounded-lg border-2 border-black dark:border-white text-center shadow-brutal-sm">
                          <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400">{s.l}</div>
                          <div className={`text-lg font-mono font-bold ${s.c || 'text-gray-800 dark:text-gray-200'}`}>{s.v}</div>
                      </div>
                  ))}
               </div>

               {/* REASONS */}
               <div className="px-4 pb-4">
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">Drivers</h3>
                  <div className="flex flex-wrap gap-2">
                     {activeMarket.reasons.map((r, i) => (
                        <span key={i} className="bg-transparent border-2 border-black dark:border-white/20 rounded px-2 py-1 text-[10px] font-bold uppercase text-gray-700 dark:text-gray-300">
                           {r}
                        </span>
                     ))}
                  </div>
               </div>

               {/* AI BOX */}
               <div className="mx-4 mb-8 p-4 border-2 border-black dark:border-white bg-gradient-to-br from-street-acid/20 to-transparent rounded-xl shadow-brutal relative overflow-hidden">
                   <div className="flex justify-between items-start mb-2 relative z-10">
                       <h3 className="font-bold text-sm uppercase flex items-center gap-2">
                           🤖 AI Analysis
                       </h3>
                   </div>

                   {!aiAnalysis && !isAnalyzing && (
                       <div className="relative z-10">
                           <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-4">
                               Generá un resumen de estructura de mercado.
                           </p>
                           <button 
                              onClick={handleAI}
                              className="w-full py-3 bg-black dark:bg-white text-white dark:text-black font-bold text-sm uppercase rounded border-2 border-transparent active:scale-[0.98] transition-all"
                           >
                              Generar Intel
                           </button>
                       </div>
                   )}

                   {isAnalyzing && (
                       <div className="py-8 flex flex-col items-center justify-center relative z-10">
                           <BrainLoader size="lg" label="PROCESANDO" />
                       </div>
                   )}

                   {aiAnalysis && !isAnalyzing && (
                       <div className="relative z-10 animate-in fade-in">
                           <p className="text-sm font-medium leading-relaxed font-mono text-gray-800 dark:text-gray-200">
                               {aiAnalysis}
                           </p>
                           <button onClick={handleAI} className="mt-4 text-xs font-bold uppercase underline text-gray-500">Actualizar</button>
                       </div>
                   )}
               </div>
               <div className="h-12"></div>
            </div>
         </div>
      )}

      {/* MODALS */}
      <ModalWrapper isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Configuración">
          <SettingsContent config={alertConfig} setConfig={setAlertConfig} />
      </ModalWrapper>

      <ModalWrapper 
        isOpen={isPredictionModalOpen} 
        onClose={() => setIsPredictionModalOpen(false)} 
        title="Predict Mode"
        color={predictionResult?.bias === 'ALCISTA' ? 'border-green-600 dark:border-street-acid' : predictionResult?.bias === 'BAJISTA' ? 'border-pink-600 dark:border-street-pink' : ''}
      >
          {predictionResult && <PredictionContent result={predictionResult} onClose={() => setIsPredictionModalOpen(false)} />}
      </ModalWrapper>

    </div>
  );
}