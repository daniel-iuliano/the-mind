import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchCandles, fetchOpenInterest, fetchOrderBookImbalance, fetchTop30Markets, fetchTicker, getExchangeAppUrl, getExchangeUrl } from './services/coinex';
import { analyzeCandles, calculateEMA, calculateOrderBlockLevels, calculateSupportResistance } from './services/indicators';
import { scoreMarket } from './services/analyzer';
import { generateAIAnalysis } from './services/geminiService';
import { generatePrediction } from './services/predictor';
import { sendTelegramMessage, formatAlertMessage, shouldSendAlert } from './services/telegram';
import { invertMarketAnalysis, invertPrediction } from './services/opposite';
import { WATCHLIST, DEFAULT_TIMEFRAME } from './constants';
import { TRANSLATIONS, REASON_CODES, translateReason, Language, getAnalyticTerm } from './services/i18n';
import { MarketAnalysis, OHLCV, Timeframe, SupportResistanceLevel, OrderBlockLevel, AlertConfig, PredictionResult, OrderBlockVisibility } from './types';
import Chart from './components/Chart';
import OrderBlockHeatmap from './components/OrderBlockHeatmap';
import { formatPrice } from './utils/formatters';

// --- Icons & Assets ---
const MoonIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>;
const SunIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const BellIcon = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
const CloseIcon = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>;
const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg className={`w-5 h-5 transition-colors ${filled ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400 hover:text-yellow-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
);
const LockIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;

type MarketState = 'VERY_ACTIVE' | 'VOLATILE' | 'CALM' | 'IDEAL_TRADING' | 'WAIT';
type MarketRegimeState =
  | 'NOISE_STAND_ASIDE'
  | 'CALM_STRUCTURED'
  | 'TREND_FOLLOW'
  | 'TREND_EXHAUSTION'
  | 'BREAKOUT_EXPANSION'
  | 'MEAN_REVERSION'
  | 'PANIC_VOLATILITY'
  | 'LIQUIDITY_TRAP'
  | 'BALANCED_ROTATION'
  | 'ACCUMULATION_PHASE';

type DetailViewTab = 'chart' | 'heatmap';

const MARKET_STATE_STYLES: Record<MarketState, string> = {
  VERY_ACTIVE: 'text-orange-700 dark:text-orange-300 border-orange-500/40 bg-orange-500/10',
  VOLATILE: 'text-pink-700 dark:text-pink-300 border-pink-500/40 bg-pink-500/10',
  CALM: 'text-blue-700 dark:text-blue-300 border-blue-500/40 bg-blue-500/10',
  IDEAL_TRADING: 'text-green-700 dark:text-green-300 border-green-500/40 bg-green-500/10',
  WAIT: 'text-gray-700 dark:text-gray-300 border-gray-500/40 bg-gray-500/10',
};

const MARKET_REGIME_STYLES: Record<MarketRegimeState, string> = {
  NOISE_STAND_ASIDE: 'text-red-700 dark:text-red-300 border-red-500/40 bg-red-500/10',
  CALM_STRUCTURED: 'text-blue-700 dark:text-blue-300 border-blue-500/40 bg-blue-500/10',
  TREND_FOLLOW: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  TREND_EXHAUSTION: 'text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10',
  BREAKOUT_EXPANSION: 'text-violet-700 dark:text-violet-300 border-violet-500/40 bg-violet-500/10',
  MEAN_REVERSION: 'text-indigo-700 dark:text-indigo-300 border-indigo-500/40 bg-indigo-500/10',
  PANIC_VOLATILITY: 'text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
  LIQUIDITY_TRAP: 'text-orange-700 dark:text-orange-300 border-orange-500/40 bg-orange-500/10',
  BALANCED_ROTATION: 'text-gray-700 dark:text-gray-300 border-gray-500/40 bg-gray-500/10',
  ACCUMULATION_PHASE: 'text-cyan-700 dark:text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
};

// --- BRAIN LOADER COMPONENT ---
interface BrainLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

const BrainLoader: React.FC<BrainLoaderProps> = ({ size = 'md', className = '', label }) => {
  const dims = { sm: "w-6 h-6", md: "w-10 h-10", lg: "w-24 h-24", xl: "w-40 h-40" };
  return (
    <div className={`flex flex-col items-center justify-center ${className} select-none pointer-events-none`}>
        <div className={`relative ${dims[size]}`}>
            <svg viewBox="0 0 100 100" className="w-full h-full text-street-acid dark:text-street-acid text-street-purple animate-heartbeat drop-shadow-glow" fill="currentColor">
                <path d="M20,50 C20,25 35,10 50,10 C65,10 80,25 80,50 C80,60 75,70 65,75 L60,85 C60,85 40,85 40,85 L35,75 C25,70 20,60 20,50 Z" opacity="0.9"/>
                <path d="M50,15 L50,85 M35,25 C35,25 65,25 65,25 M30,50 L70,50 M40,65 L60,65" stroke="rgba(0,0,0,0.2)" strokeWidth="3" fill="none" strokeLinecap="round"/>
            </svg>
            <svg className="absolute inset-0 w-full h-full animate-lightning pointer-events-none text-white mix-blend-overlay" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2">
                 <path d="M10,40 L20,45" opacity="0.8" />
                 <path d="M90,40 L80,45" opacity="0.8" />
            </svg>
        </div>
        {label && <span className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] animate-pulse opacity-80 text-street-dark dark:text-street-light">{label}</span>}
    </div>
  );
};

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
    <span className={`font-mono font-bold transition-all duration-300 ${flash === 'up' ? 'text-green-600 dark:text-street-acid scale-110 inline-block' : flash === 'down' ? 'text-pink-600 dark:text-street-pink scale-110 inline-block' : 'text-inherit'}`}>
      ${formatPrice(price)}
    </span>
  );
};

const StreetBadge = ({ text, type }: { text: string, type: 'bull' | 'bear' | 'neutral' }) => {
  const colors = {
    bull: 'bg-street-acid text-black border-black',
    bear: 'bg-street-pink text-white border-black',
    neutral: 'bg-gray-300 text-gray-800 border-black'
  };
  return <span className={`${colors[type]} px-2 py-0.5 text-[10px] font-bold uppercase border-2 shadow-brutal-sm transform -rotate-1`}>{text}</span>;
};

interface MarketCardProps {
  data: MarketAnalysis;
  onClick: () => void;
  isLoading: boolean;
  isFavorite: boolean;
  onToggleFav: (e: React.MouseEvent) => void;
  lang: Language;
}

const MarketCard: React.FC<MarketCardProps> = ({ data, onClick, isLoading, isFavorite, onToggleFav, lang }) => {
  const t = TRANSLATIONS[lang];
  const isBull = data.bias.includes('BUY');
  const isBear = data.bias.includes('SELL');
  const hasEarlySignal = data.earlySignal.side !== 'NEUTRAL' && data.earlySignal.confidence > 0;
  const earlyLabel = data.earlySignal.side === 'LONG' ? t.EARLY_LONG : t.EARLY_SHORT;
  const isPerfectTrade = !!data.perfectTrade?.active;
  const isBestKey = data.perfectTrade?.bestKey === data.symbol;
  const isWorstKey = data.perfectTrade?.worstKey === data.symbol;

  return (
    <div onClick={onClick} className={`group bg-street-cardLight dark:bg-street-cardDark rounded-xl p-4 mb-3 border-2 transition-all cursor-pointer relative overflow-hidden ${isPerfectTrade ? 'border-yellow-400 ring-2 ring-yellow-300/70 shadow-[0_0_0_2px_rgba(250,204,21,0.35)] animate-pulse' : isFavorite ? 'border-yellow-400 dark:border-yellow-400 ring-1 ring-yellow-400/50' : 'border-black dark:border-white shadow-brutal active:shadow-none active:translate-x-[4px] active:translate-y-[4px]'}`}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button onClick={onToggleFav} className="p-1 -ml-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors active:scale-90"><StarIcon filled={isFavorite} /></button>
            <h3 className="text-lg font-extrabold italic tracking-tight">{data.symbol}</h3>
            {isPerfectTrade && <span className="px-1.5 py-0.5 text-[9px] font-black uppercase border border-yellow-500 bg-yellow-300/80 text-black">{t.STAR_TRADE}</span>}
            {isBestKey && <span className="px-1.5 py-0.5 text-[9px] font-black uppercase border border-green-700 bg-green-300/80 text-black">{t.BEST_KEY}</span>}
            {isWorstKey && <span className="px-1.5 py-0.5 text-[9px] font-black uppercase border border-pink-700 bg-pink-300/80 text-black">{t.WORST_KEY}</span>}
            {isLoading && <BrainLoader size="sm" />}
          </div>
          <div className="flex items-center gap-3 text-xs font-bold text-gray-600 dark:text-gray-400">
             <PriceDisplay price={data.price} />
             <span className={`${data.change24h >= 0 ? 'text-green-600 dark:text-street-acid' : 'text-pink-600 dark:text-street-pink'}`}>
               {data.change24h > 0 ? '▲' : '▼'} {Math.abs(data.change24h).toFixed(2)}%
             </span>
          </div>
          {hasEarlySignal && (
            <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 flex items-center gap-2">
              <span className={`px-1.5 py-0.5 border border-black/60 dark:border-white/40 ${data.earlySignal.side === 'LONG' ? 'text-green-700 dark:text-street-acid' : 'text-pink-600 dark:text-street-pink'}`}>
                {earlyLabel}
              </span>
              <span>{data.earlySignal.confidence}%</span>
            </div>
          )}
          {data.perfectTrade && (
            <div className="mt-2 text-[10px] font-semibold text-gray-700 dark:text-gray-300">
              <span className="inline-flex items-center gap-1 mr-1">{t.CONFLUENCE_SCORE} <AnalyticTermHelp term="CONFLUENCE" lang={lang} /></span> {data.perfectTrade.confluenceScore}/100 • <span className="inline-flex items-center gap-1 mr-1">{t.ROBUST_SCORE} <AnalyticTermHelp term="ROBUST" lang={lang} /></span> {Math.round(data.perfectTrade.robustScore)} • RR {data.perfectTrade.rr.toFixed(2)}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
            <div className={`w-8 h-8 flex items-center justify-center rounded-full border-2 border-black dark:border-white font-extrabold text-xs ${data.score >= 70 ? 'bg-street-acid text-black' : data.score <= 30 ? 'bg-street-pink text-white' : 'bg-gray-200 text-gray-800'}`}>{Math.round(data.score)}</div>
            {isBull && <StreetBadge text={t.BULL} type="bull" />}
            {isBear && <StreetBadge text={t.BEAR} type="bear" />}
        </div>
      </div>
      <div className="mt-3 w-full h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden border border-black dark:border-white">
          <div className={`h-full ${isBull ? 'bg-street-acid' : 'bg-street-pink'}`} style={{ width: `${Math.min(data.score, 100)}%` }} />
      </div>
    </div>
  );
};

const ModalWrapper = ({ isOpen, onClose, title, children, color = "border-black dark:border-white" }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative w-full sm:max-w-md bg-street-cardLight dark:bg-street-cardDark border-t-4 sm:border-4 ${color} shadow-brutal-white sm:shadow-brutal sm:rounded-2xl animate-in slide-in-from-bottom duration-300 flex flex-col max-h-[90vh]`}>
                <div className="flex justify-between items-center p-4 border-b-2 border-inherit bg-street-light dark:bg-black/20">
                    <h2 className="text-lg font-bold uppercase tracking-tight italic flex items-center gap-2">{title}</h2>
                    <button onClick={onClose} className="p-1 hover:bg-black/10 rounded active:scale-90 transition-transform"><CloseIcon /></button>
                </div>
                <div className="overflow-y-auto p-4 sm:p-6">{children}</div>
            </div>
        </div>
    );
};



const AnalyticTermHelp = ({ term, lang }: { term: 'CONFLUENCE' | 'ROBUST' | 'SCORE' | 'PERFECT_TRADE', lang: Language }) => {
  const content = getAnalyticTerm(term, lang);
  return (
    <span className="relative inline-flex items-center group">
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-black rounded-full border border-current text-gray-500 dark:text-gray-400 cursor-help" aria-label={content.description}>?</span>
      <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute z-20 left-1/2 -translate-x-1/2 top-5 w-56 p-2 rounded-md border border-black/20 dark:border-white/20 bg-white dark:bg-street-cardDark text-[10px] normal-case font-semibold text-gray-700 dark:text-gray-200 shadow-lg">
        <span className="block font-black uppercase mb-1">{content.label}</span>
        <span>{content.description}</span>
      </span>
    </span>
  );
};


const translateTemplate = (template: string, params: Record<string, string | number>): string => {
  return Object.entries(params).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)), template);
};

const getPerfectTradeLine = (line: string, lang: Language, perfectTrade: NonNullable<MarketAnalysis['perfectTrade']>) => {
  const t = TRANSLATIONS[lang] as Record<string, string>;
  const template = t[line] ?? line;
  if (!template.includes('{')) return template;
  return translateTemplate(template, {
    confluence: perfectTrade.confluenceScore,
    aligned: Math.min(8, Math.max(0, Math.round((perfectTrade.confluenceScore / 100) * 8))),
    stability: perfectTrade.stabilityMinutes.toFixed(1),
    robust: perfectTrade.robustScore.toFixed(1),
    rr: perfectTrade.rr.toFixed(2),
    sl: perfectTrade.sl ? formatPrice(perfectTrade.sl) : '---',
    tp: perfectTrade.tp ? formatPrice(perfectTrade.tp) : '---',
  });
};

const getPredictionBiasLabel = (bias: PredictionResult['bias'], lang: Language): string => {
    if (lang === 'ES') {
        if (bias === 'ALCISTA') return 'Sesgo Long';
        if (bias === 'BAJISTA') return 'Sesgo Short';
        return 'Neutral';
    }
    if (bias === 'ALCISTA') return 'Long Bias';
    if (bias === 'BAJISTA') return 'Short Bias';
    return 'Neutral';
};

const PredictionContent = ({ result, currentPrice, onClose, onOpenPosition, lang }: { result: PredictionResult, currentPrice: number | null, onClose: () => void, onOpenPosition: () => void, lang: Language }) => {
    const t = TRANSLATIONS[lang];
    const isBull = result.bias === 'ALCISTA';
    const accentColor = isBull ? 'text-green-600 dark:text-street-acid' : result.bias === 'BAJISTA' ? 'text-pink-600 dark:text-street-pink' : 'text-gray-600 dark:text-gray-400';
    const [desiredProfit, setDesiredProfit] = useState<string>('100');
    const parsedDesiredProfit = Number(desiredProfit);
    const perUnitProfit = result.targetPrice && currentPrice ? (isBull ? result.targetPrice - currentPrice : result.bias === 'BAJISTA' ? currentPrice - result.targetPrice : 0) : 0;
    const estimatedUnits = parsedDesiredProfit > 0 && perUnitProfit > 0 ? parsedDesiredProfit / perUnitProfit : 0;
    const estimatedCapital = estimatedUnits > 0 && currentPrice ? estimatedUnits * currentPrice : 0;
    
    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t.DIRECTION}</span>
                    <span className={`text-3xl font-extrabold italic tracking-tighter ${accentColor}`}>{getPredictionBiasLabel(result.bias, lang)}</span>
                </div>
                <div className="text-right">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{t.CONFIDENCE}</span>
                    <div className="text-3xl font-extrabold">{result.probability}%</div>
                </div>
            </div>
            <div className="p-4 border-2 border-black dark:border-white bg-street-light dark:bg-black/40 rounded-xl relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${isBull ? 'bg-street-acid' : 'bg-street-pink'}`}></div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                         <div className="text-xs font-bold uppercase mb-1 text-gray-600 dark:text-gray-300">{t.TARGET}</div>
                         <div className="text-lg font-mono font-bold text-green-700 dark:text-street-acid">{result.targetPrice ? `$${formatPrice(result.targetPrice)}` : '---'}</div>
                    </div>
                    <div>
                         <div className="text-xs font-bold uppercase mb-1 text-gray-600 dark:text-gray-300">{t.STOP_LOSS}</div>
                         <div className="text-lg font-mono font-bold text-pink-700 dark:text-street-pink">{result.stopLoss ? `$${formatPrice(result.stopLoss)}` : '---'}</div>
                    </div>
                </div>
            </div>
            <div className="space-y-4">
                <div>
                    <h3 className="text-sm font-bold uppercase border-b-2 border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-2">{t.NOW_WHAT_HAPPENING}</h3>
                    <ul className="space-y-2">
                        {result.nowSummary.map((r, i) => (
                            <li key={`now-${i}`} className="flex items-start gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                                <span className="text-green-600 dark:text-street-acid">➜</span>
                                {translateReason(r, lang)}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h3 className="text-sm font-bold uppercase border-b-2 border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-2">{t.NEXT_WHAT_COULD_HAPPEN}</h3>
                    <ul className="space-y-2">
                        {result.nextScenarios.map((r, i) => (
                            <li key={`next-${i}`} className="flex items-start gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                                <span className="text-pink-600 dark:text-street-pink">➜</span>
                                {translateReason(r, lang)}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h3 className="text-sm font-bold uppercase border-b-2 border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-2">{t.ALPHA_INTEL}</h3>
                    <ul className="space-y-2">
                        {result.reasoning.map((r, i) => (
                            <li key={`intel-${i}`} className="flex items-start gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                                <span className="text-green-600 dark:text-street-acid">➜</span>
                                {translateReason(r, lang)}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h3 className="text-sm font-bold uppercase border-b-2 border-dashed border-gray-400 dark:border-gray-600 pb-1 mb-2">{t.PREDICTION_VALIDATION}</h3>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase">
                        <div className="border border-black/20 dark:border-white/20 rounded p-2">
                            <div className="text-gray-500 dark:text-gray-400">{t.VALIDATION_STATUS}</div>
                            <div className={`text-xs ${result.validation.passed ? 'text-green-700 dark:text-street-acid' : 'text-pink-700 dark:text-street-pink'}`}>
                                {result.validation.passed ? t.VALIDATION_PASS : t.VALIDATION_FAIL}
                            </div>
                        </div>
                        <div className="border border-black/20 dark:border-white/20 rounded p-2">
                            <div className="text-gray-500 dark:text-gray-400">{t.CONFLUENCE_SCORE}</div>
                            <div className="text-xs text-gray-800 dark:text-gray-100">{result.validation.confluenceScore}/{result.validation.threshold}</div>
                        </div>
                        <div className="border border-black/20 dark:border-white/20 rounded p-2 col-span-2">
                            <div className="text-gray-500 dark:text-gray-400">{t.CONFIRMATION_COUNT}</div>
                            <div className="text-xs text-gray-800 dark:text-gray-100">{result.validation.confirmations}</div>
                        </div>
                    </div>
                    <div className="mt-2 space-y-1">
                        {result.auditTrail.map((audit, i) => (
                            <div key={`audit-${i}`} className="text-[10px] border border-black/20 dark:border-white/20 rounded p-2">
                                <div className="font-bold uppercase text-gray-700 dark:text-gray-200">{audit.factor.replace(/_/g, ' ')}</div>
                                <div className="text-gray-500 dark:text-gray-400">{audit.details}</div>
                                <div className="text-gray-700 dark:text-gray-300">{t.SCORE.toLowerCase()}: {audit.score.toFixed(1)} • {t.AUDIT_WEIGHT}: {audit.weight.toFixed(2)} • {t.AUDIT_CONTRIBUTION}: {audit.contribution.toFixed(2)} • {audit.direction}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="p-4 border-2 border-black dark:border-white bg-street-cardLight dark:bg-street-cardDark rounded-xl space-y-3">
                <div className="text-xs font-bold uppercase text-gray-600 dark:text-gray-300">{t.PROFIT_CONFIG}</div>
                <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">{t.DESIRED_PROFIT}</label>
                <input
                    type="number"
                    min="0"
                    step="1"
                    value={desiredProfit}
                    onChange={(e) => setDesiredProfit(e.target.value)}
                    className="w-full bg-transparent border-2 border-black dark:border-white p-2 font-mono text-xs font-bold outline-none focus:border-street-acid text-street-dark dark:text-street-light"
                />
                <div className="grid grid-cols-2 gap-3 text-[10px] font-bold uppercase text-gray-600 dark:text-gray-300">
                    <div className="p-2 border border-black/20 dark:border-white/20 rounded-lg">
                        <div className="text-[9px]">{t.ESTIMATED_UNITS}</div>
                        <div className="text-sm font-mono text-gray-800 dark:text-gray-100">{estimatedUnits > 0 ? estimatedUnits.toFixed(4) : '---'}</div>
                    </div>
                    <div className="p-2 border border-black/20 dark:border-white/20 rounded-lg">
                        <div className="text-[9px]">{t.ESTIMATED_CAPITAL}</div>
                        <div className="text-sm font-mono text-gray-800 dark:text-gray-100">{estimatedCapital > 0 ? `$${estimatedCapital.toFixed(2)}` : '---'}</div>
                    </div>
                </div>
                {(!currentPrice || !result.targetPrice || perUnitProfit <= 0) && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{t.PROFIT_UNAVAILABLE}</p>
                )}
            </div>
            <button onClick={onOpenPosition} className="w-full py-4 bg-street-cyan text-black font-extrabold text-sm uppercase tracking-widest border-2 border-black shadow-brutal active:shadow-none active:translate-x-1 active:translate-y-1 transition-all flex items-center justify-center gap-2 group">
                <span>{t.OPEN_COINEX}</span>
                <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
            <button onClick={onClose} className="w-full py-3 bg-street-dark dark:bg-street-light text-street-light dark:text-street-dark font-extrabold text-sm uppercase tracking-widest border-2 border-transparent active:scale-[0.98] transition-all">{t.CLOSE}</button>
        </div>
    );
};

const SettingsContent = ({ config, setConfig, isOppositeMode, onToggleOppositeMode, onClearKeys, lang }: any) => {
    const t = TRANSLATIONS[lang];
    return (
        <div className="space-y-6">
             <div className="flex items-center justify-between p-4 border-2 border-black dark:border-white rounded-xl bg-street-light dark:bg-black/20">
                <span className="font-bold text-sm uppercase text-gray-800 dark:text-white">{t.ACTIVE_ALERTS}</span>
                <button onClick={() => setConfig({...config, enabled: !config.enabled})} className={`w-14 h-8 rounded-full border-2 border-black dark:border-white transition-colors relative ${config.enabled ? 'bg-street-acid' : 'bg-gray-400'}`}>
                    <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-black border border-white transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>
            <div className="p-4 border-2 border-street-pink/50 bg-street-pink/10 rounded-xl relative overflow-hidden">
                <div className="absolute -right-4 -top-4 text-6xl opacity-20">🌓</div>
                <div className="flex items-center justify-between relative z-10">
                    <div>
                        <span className="font-bold text-sm uppercase text-street-pink block">{t.OPPOSITE_MODE}</span>
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400 max-w-[150px] block leading-tight mt-1">{t.OPPOSITE_DESC}</span>
                    </div>
                    <button onClick={onToggleOppositeMode} className={`w-14 h-8 rounded-full border-2 border-black dark:border-white transition-colors relative ${isOppositeMode ? 'bg-street-pink' : 'bg-gray-400'}`}>
                        <div className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-black border border-white transition-transform ${isOppositeMode ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
            <div className="border-t-2 border-dashed border-gray-300 dark:border-gray-700 pt-4">
                 <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">{t.SECURE_STORAGE}</h3>
                 <button onClick={onClearKeys} className="w-full py-2 border-2 border-street-pink text-street-pink font-bold text-xs uppercase hover:bg-street-pink hover:text-white transition-colors">{t.CLEAR_KEYS}</button>
            </div>
            <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">{t.TELEGRAM_CONFIG}</h3>
                <input type="text" placeholder="BOT TOKEN" value={config.telegramToken} onChange={(e) => setConfig({...config, telegramToken: e.target.value})} className="w-full bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid placeholder-gray-500 text-street-dark dark:text-street-light" />
                <input type="text" placeholder="CHAT ID" value={config.telegramChatId} onChange={(e) => setConfig({...config, telegramChatId: e.target.value})} className="w-full bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid placeholder-gray-500 text-street-dark dark:text-street-light" />
            </div>
        </div>
    );
}

const CoinExKeyModal = ({ onSave, onClose, lang }: { onSave: (k: string, s: string) => void, onClose: () => void, lang: Language }) => {
    const [key, setKey] = useState('');
    const [secret, setSecret] = useState('');
    const t = TRANSLATIONS[lang];

    return (
        <div className="space-y-4">
            <div className="bg-street-acid/10 border-l-4 border-street-acid p-3 text-xs font-medium text-gray-700 dark:text-gray-300">
                <p className="font-bold uppercase mb-1 flex items-center gap-1"><LockIcon /> {t.SECURE_STORAGE}</p>
                {t.SECURE_DESC}
            </div>
            <div>
                <label className="text-xs font-bold uppercase text-gray-500">{t.API_KEY}</label>
                <input type="text" value={key} onChange={(e) => setKey(e.target.value)} className="w-full mt-1 bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid text-street-dark dark:text-street-light" />
            </div>
            <div>
                <label className="text-xs font-bold uppercase text-gray-500">{t.API_SECRET}</label>
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="w-full mt-1 bg-transparent border-2 border-black dark:border-white p-3 font-mono text-xs font-bold outline-none focus:border-street-acid text-street-dark dark:text-street-light" />
            </div>
            <button onClick={() => onSave(key, secret)} disabled={!key || !secret} className="w-full py-3 bg-street-acid text-black font-extrabold text-sm uppercase tracking-widest border-2 border-black shadow-brutal active:shadow-none active:translate-y-1 transition-all disabled:opacity-50">{t.SAVE_KEYS}</button>
        </div>
    );
}

const PositionConfirmationModal = ({ prediction, onConfirm, onCancel, lang }: { prediction: PredictionResult, onConfirm: () => void, onCancel: () => void, lang: Language }) => {
    const isBull = prediction.bias === 'ALCISTA';
    const t = TRANSLATIONS[lang];
    return (
        <div className="space-y-4">
            <div className={`p-4 border-2 ${isBull ? 'border-green-600 bg-green-50 dark:bg-green-900/20' : 'border-pink-600 bg-pink-50 dark:bg-pink-900/20'} rounded-xl`}>
                 <h3 className="font-black text-xl uppercase italic mb-2">{t.CONFIRM_TITLE}</h3>
                 <div className="space-y-2 text-sm font-bold font-mono">
                     <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-1">
                         <span>{t.PAIR}</span>
                         <span>{prediction.symbol}</span>
                     </div>
                     <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-1">
                         <span>{t.SIDE}</span>
                         <span className={isBull ? 'text-green-600' : 'text-pink-600'}>{isBull ? t.SIDE_LONG : t.SIDE_SHORT}</span>
                     </div>
                     <div className="flex justify-between border-b border-black/10 dark:border-white/10 pb-1">
                         <span>{t.TARGET}</span>
                         <span>{prediction.targetPrice ? `$${formatPrice(prediction.targetPrice)}` : '---'}</span>
                     </div>
                     <div className="flex justify-between">
                         <span>{t.STOP}</span>
                         <span className="text-street-pink">{prediction.stopLoss ? `$${formatPrice(prediction.stopLoss)}` : '---'}</span>
                     </div>
                 </div>
            </div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium leading-relaxed border-l-2 border-gray-400 pl-2">
                <strong>{t.DISCLAIMER_LABEL}:</strong> {t.DISCLAIMER}
            </p>
            <div className="flex gap-2 pt-2">
                <button onClick={onCancel} className="flex-1 py-3 bg-transparent text-gray-500 font-bold text-xs uppercase border-2 border-transparent hover:border-gray-300">{t.CANCEL}</button>
                <button onClick={onConfirm} className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black font-extrabold text-sm uppercase tracking-widest border-2 border-transparent shadow-brutal active:shadow-none active:translate-y-1 transition-all">{t.CONFIRM_OPEN}</button>
            </div>
        </div>
    );
}

// --- Main App ---
export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [filter, setFilter] = useState<'ALL' | 'BULL' | 'BEAR'>('ALL');
  const [isOppositeMode, setIsOppositeMode] = useState(false);
  // Language State
  const [lang, setLang] = useState<Language>(() => {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;
      if (saved && (saved === 'ES' || saved === 'EN')) return saved;
      return navigator.language.startsWith('es') ? 'ES' : 'EN';
  });
  const t = TRANSLATIONS[lang];

  // Ref to hold current language for scanner interval
  const langRef = useRef(lang);
  useEffect(() => {
      langRef.current = lang;
      localStorage.setItem('lang', lang);
  }, [lang]);

  const [marketData, setMarketData] = useState<MarketAnalysis[]>([]);
  const [marketOrder, setMarketOrder] = useState<string[]>(WATCHLIST);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [dynamicWatchlist, setDynamicWatchlist] = useState<string[]>(WATCHLIST);
  const [isWatchlistLoaded, setIsWatchlistLoaded] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
        const saved = localStorage.getItem('quantmind_favorites');
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [activeTimeframe, setActiveTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [isScanning, setIsScanning] = useState(true);
  const [chartData, setChartData] = useState<(OHLCV & { ema20?: number, ema50?: number })[]>([]);
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line');
  const [orderBlockVisibility, setOrderBlockVisibility] = useState<OrderBlockVisibility>({
    demand: true,
    supply: true,
    liquidity: true,
    highVolume: true,
  });
  const [heatmapOverlayFilter, setHeatmapOverlayFilter] = useState<'all' | keyof OrderBlockVisibility>('all');
  const [detailViewTab, setDetailViewTab] = useState<DetailViewTab>('chart');
  const [srLevels, setSrLevels] = useState<SupportResistanceLevel[]>([]);
  const [orderBlockLevels, setOrderBlockLevels] = useState<OrderBlockLevel[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [isPredictionModalOpen, setIsPredictionModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [isPositionConfirmOpen, setIsPositionConfirmOpen] = useState(false);
  const [coinexKeys, setCoinexKeys] = useState<{key: string, secret: string} | null>(() => {
      if (typeof localStorage === 'undefined') return null;
      const stored = localStorage.getItem('quantmind_keys');
      if (!stored) return null;
      try {
          const decoded = atob(stored);
          return JSON.parse(decoded);
      } catch { return null; }
  });
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [isMarketPanelExpanded, setIsMarketPanelExpanded] = useState(true);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('quantmind_alert_config') : null;
    return saved ? JSON.parse(saved) : {
        enabled: false, predictMode: false, telegramToken: '', telegramChatId: '',
        scope: 'ALL', selectedPairs: [], signals: { buy: true, sell: true },
        sensitivity: 'MEDIUM', throttleMinutes: 60, events: { highScore: true, volumeSpike: true, trendBreak: true }
    };
  });
  const lastAlertsRef = useRef<Map<string, number>>(new Map());
  const orderFlowRef = useRef<Map<string, number | null>>(new Map());

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'dark' | 'light' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);
  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => localStorage.setItem('quantmind_opposite_mode', String(isOppositeMode)), [isOppositeMode]);
  useEffect(() => localStorage.setItem('quantmind_favorites', JSON.stringify(favorites)), [favorites]);
  useEffect(() => localStorage.setItem('quantmind_alert_config', JSON.stringify(alertConfig)), [alertConfig]);

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));
  const withLoader = async (fn: () => void | Promise<any>) => {
    setIsGlobalLoading(true);
    const maxTime = new Promise((resolve) => setTimeout(resolve, 2000));
    const action = async () => { await fn(); };
    await Promise.race([action(), maxTime]);
    setIsGlobalLoading(false);
  };

  useEffect(() => {
    const initMarket = async () => {
      try {
        const topPairs = await fetchTop30Markets();
        if (topPairs.length > 0) setDynamicWatchlist(topPairs);
      } catch (e) { console.warn("Fallback WL"); } finally { setIsWatchlistLoaded(true); }
    };
    initMarket();
  }, []);

  useEffect(() => {
    setMarketOrder((prev) => {
      const next = [...prev];
      dynamicWatchlist.forEach((symbol) => {
        if (!next.includes(symbol)) next.push(symbol);
      });
      return next;
    });
  }, [dynamicWatchlist]);

  const loadDetailData = async (symbol: string, tf: Timeframe) => {
    setChartData([]); setSrLevels([]); setOrderBlockLevels([]); setAiAnalysis(""); 
    try {
        const candles = await fetchCandles(symbol, tf);
        if (!candles || candles.length < 50) return;
        const closes = candles.map((c) => c.close);
        const ema20Arr = calculateEMA(closes, 20);
        const ema50Arr = calculateEMA(closes, 50);
        const chartWithIndicators = candles.map((c, i) => ({
            ...c,
            ema20: i >= 19 ? ema20Arr[i] : undefined,
            ema50: i >= 49 ? ema50Arr[i] : undefined,
        })).slice(-80); 
        setChartData(chartWithIndicators);
        setSrLevels(calculateSupportResistance(candles));
        setOrderBlockLevels(calculateOrderBlockLevels(candles));
    } catch (e) { console.error(e); }
  };

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
          setMarketData([]);
          if (selectedSymbol) await loadDetailData(selectedSymbol, tf);
      });
  };

  const handleFilterChange = (f: 'ALL' | 'BULL' | 'BEAR') => {
      if (filter === f) return;
      withLoader(async () => { await wait(300); setFilter(f); });
  };
  
  const handleLangChange = (l: Language) => {
      if (lang === l) return;
      withLoader(async () => {
          await wait(300); // Simulate thinking
          setLang(l);
      });
  };

  const toggleFavorite = (symbol: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setFavorites(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  };

  const handlePredict = () => {
      if (!selectedSymbol) return;
      const analysis = marketData.find(m => m.symbol === selectedSymbol);
      if (!analysis) return;
      withLoader(async () => {
          await wait(600); 
          const orderFlow = orderFlowRef.current.get(selectedSymbol) ?? null;
          const result = generatePrediction(analysis, srLevels, chartData, orderFlow);
          const displayResult = isOppositeMode ? invertPrediction(result) : result;
          setPredictionResult(displayResult);
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
            const displayAnalysis = isOppositeMode ? invertMarketAnalysis(analysis) : analysis;
            const res = await generateAIAnalysis(displayAnalysis, lang);
            setAiAnalysis(res);
        } catch (e: any) {
            setAiAnalysis(e.message || "Error");
        } finally { setIsAnalyzing(false); }
    });
  };

  const toggleSettings = () => withLoader(() => setIsSettingsOpen(!isSettingsOpen));
  const toggleTheme = () => withLoader(() => setTheme(theme === 'dark' ? 'light' : 'dark'));
  const toggleScanning = () => withLoader(() => setIsScanning(!isScanning));
  
  const handleOpenPositionFlow = () => {
      if (!coinexKeys) setIsKeyModalOpen(true); else setIsPositionConfirmOpen(true);
  };
  const saveKeys = (key: string, secret: string) => {
      const obj = { key, secret };
      const str = JSON.stringify(obj);
      localStorage.setItem('quantmind_keys', btoa(str));
      setCoinexKeys(obj);
      setIsKeyModalOpen(false);
      setIsPositionConfirmOpen(true);
  };
  const clearKeys = () => { localStorage.removeItem('quantmind_keys'); setCoinexKeys(null); };
  const executeHandoff = () => {
      if (!selectedSymbol) return;
      const appUrl = getExchangeAppUrl(selectedSymbol);
      const webUrl = getExchangeUrl(selectedSymbol);
      window.location.assign(appUrl);
      window.setTimeout(() => {
          if (document.visibilityState === 'visible') {
              window.open(webUrl, '_blank');
          }
      }, 1500);
      setIsPositionConfirmOpen(false);
      setIsPredictionModalOpen(false);
  };

  const runScan = useCallback(async () => {
    if (!isScanning || !isWatchlistLoaded) return;
    for (const symbol of dynamicWatchlist) {
      if (!isScanning) break;
      setLoadingMap(prev => ({ ...prev, [symbol]: true }));
      try {
        const [candles, ticker, orderBookImbalance, oiCurrent] = await Promise.all([
             fetchCandles(symbol, activeTimeframe).catch(e => null),
             fetchTicker(symbol).catch(e => null),
             fetchOrderBookImbalance(symbol).catch(() => null),
             fetchOpenInterest(symbol).catch(() => null)
        ]);
        if (!candles || candles.length < 50) continue;
        const indicators = analyzeCandles(candles);
        const livePrice = ticker ? ticker.last : candles[candles.length - 1].close;
        const liveVolume = ticker ? ticker.vol : candles[candles.length - 1].volume;
        const prevCandle = candles[candles.length - 2];
        const prevVolume = prevCandle.volume; 
        const open24h = candles[candles.length - Math.min(24, candles.length)]?.open || livePrice;
        const changeVal = ticker ? ticker.change : ((livePrice - open24h) / open24h) * 100;
        const analysis = scoreMarket(symbol, livePrice, indicators, liveVolume, prevVolume, changeVal, orderBookImbalance, candles, activeTimeframe, oiCurrent, null);
        orderFlowRef.current.set(symbol, orderBookImbalance ?? null);

        setMarketData(prevData => {
            const existingIndex = prevData.findIndex((d) => d.symbol === symbol);
            if (existingIndex === -1) {
              return [...prevData, analysis];
            }
            const updated = [...prevData];
            updated[existingIndex] = analysis;
            return updated;
        });

        const lastAlertTime = lastAlertsRef.current.get(symbol) || 0;
        if (shouldSendAlert(analysis, alertConfig, lastAlertTime)) {
            let prediction: PredictionResult | null = null;
            if (alertConfig.predictMode && analysis.score >= 75) {
                const levels = calculateSupportResistance(candles);
                prediction = generatePrediction(analysis, levels, candles, orderBookImbalance ?? null);
                if (isOppositeMode) {
                  prediction = invertPrediction(prediction);
                }
            }
            const displayAnalysis = isOppositeMode ? invertMarketAnalysis(analysis) : analysis;
            const msg = formatAlertMessage(displayAnalysis, activeTimeframe, prediction, langRef.current);
            await sendTelegramMessage(alertConfig.telegramToken, alertConfig.telegramChatId, msg);
            lastAlertsRef.current.set(symbol, Date.now());
        }
      } catch (err) { /* quiet fail */ } finally { setLoadingMap(prev => ({ ...prev, [symbol]: false })); }
      await wait(200); 
    }
  }, [isScanning, activeTimeframe, alertConfig, dynamicWatchlist, isWatchlistLoaded, isOppositeMode]);

  useEffect(() => {
    runScan();
    const interval = setInterval(runScan, 10000); 
    return () => clearInterval(interval);
  }, [runScan]);

  const displayMarketData = useMemo(() => {
      return isOppositeMode ? marketData.map(invertMarketAnalysis) : marketData;
  }, [marketData, isOppositeMode]);

  const activeMarket = displayMarketData.find(m => m.symbol === selectedSymbol);

  useEffect(() => {
    setDetailViewTab('chart');
  }, [selectedSymbol]);

  const heatmapInsight = useMemo(() => {
    if (!chartData.length || !orderBlockLevels.length) return null;

    const relevantLevels = orderBlockLevels.filter((level) =>
      ['demand', 'supply', 'liquidity', 'highVolume'].includes(level.type),
    );
    if (!relevantLevels.length) return null;

    const currentPrice = chartData.at(-1)?.close ?? 0;
    const longLevels = relevantLevels.filter((level) => level.type !== 'supply');
    const shortLevels = relevantLevels.filter((level) => level.type === 'supply');
    const longPressure = longLevels.reduce((sum, level) => sum + level.strength, 0);
    const shortPressure = shortLevels.reduce((sum, level) => sum + level.strength, 0);

    const strongestClusters = [...relevantLevels]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3)
      .map((level) => {
        const distance = currentPrice > 0 ? ((level.price - currentPrice) / currentPrice) * 100 : 0;
        const side = level.type === 'supply' ? 'SHORT' : 'LONG';
        const sideLabel = lang === 'ES' ? (side === 'SHORT' ? 'SHORT' : 'LONG') : side;
        const zoneLabel =
          lang === 'ES'
            ? level.type === 'supply'
              ? 'Zona de oferta'
              : level.type === 'demand'
                ? 'Zona de demanda'
                : level.type === 'liquidity'
                  ? 'Clúster de liquidez'
                  : 'Nodo de alto volumen'
            : level.type === 'supply'
              ? 'Supply zone'
              : level.type === 'demand'
                ? 'Demand zone'
                : level.type === 'liquidity'
                  ? 'Liquidity cluster'
                  : 'High-volume node';
        return {
          label: zoneLabel,
          side: sideLabel,
          strength: level.strength,
          distance,
          price: level.price,
        };
      });

    const imbalanceScore = Math.abs(longPressure - shortPressure) / Math.max(longPressure + shortPressure, 1);

    const contextLine =
      longPressure > shortPressure
        ? lang === 'ES'
          ? 'Los bolsillos de liquidez long son más densos; barridos bajistas podrían activar compras de respuesta.'
          : 'Long liquidity pockets are denser, suggesting downside sweeps could attract responsive buying.'
        : lang === 'ES'
          ? 'Las bandas de liquidez short son más densas; barridos alcistas podrían encontrar oferta agresiva.'
          : 'Short liquidity bands are denser, suggesting upside sweeps may face aggressive supply response.';

    return {
      currentPrice,
      longPressure,
      shortPressure,
      strongestClusters,
      imbalanceScore,
      contextLine,
    };
  }, [chartData, lang, orderBlockLevels]);

  useEffect(() => {
    setOrderBlockVisibility({
      demand: heatmapOverlayFilter === 'all' || heatmapOverlayFilter === 'demand',
      supply: heatmapOverlayFilter === 'all' || heatmapOverlayFilter === 'supply',
      liquidity: heatmapOverlayFilter === 'all' || heatmapOverlayFilter === 'liquidity',
      highVolume: heatmapOverlayFilter === 'all' || heatmapOverlayFilter === 'highVolume',
    });
  }, [heatmapOverlayFilter]);

  const marketStatusSummary = useMemo(() => {
      if (displayMarketData.length === 0) return null;

      const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
      const ratio = (value: number, base: number) => (base > 0 ? value / base : 1);

      const changes = displayMarketData.map((item) => item.change24h);
      const absChanges = changes.map((change) => Math.abs(change));
      const volumes = displayMarketData.map((item) => item.volume24h).filter((v) => Number.isFinite(v) && v > 0);
      const scores = displayMarketData.map((item) => item.score);
      const buyCount = displayMarketData.filter((item) => item.bias.includes('BUY')).length;
      const sellCount = displayMarketData.filter((item) => item.bias.includes('SELL')).length;
      const bullishConditionCount = displayMarketData.filter((item) => item.marketCondition === 'BULLISH').length;
      const bearishConditionCount = displayMarketData.filter((item) => item.marketCondition === 'BEARISH').length;

      const avgAbsChange = absChanges.reduce((sum, change) => sum + change, 0) / absChanges.length;
      const meanChange = changes.reduce((sum, change) => sum + change, 0) / changes.length;
      const volatility = Math.sqrt(changes.reduce((sum, change) => sum + Math.pow(change - meanChange, 2), 0) / changes.length);
      const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

      const sortedVolumes = [...volumes].sort((a, b) => a - b);
      const medianVolume = sortedVolumes.length > 0 ? sortedVolumes[Math.floor(sortedVolumes.length / 2)] : 1;
      const avgVolume = volumes.length > 0 ? volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length : 1;
      const volumeIntensity = ratio(avgVolume, medianVolume);

      const atrValues = displayMarketData.map((item) => (item.price > 0 ? item.indicators.atr / item.price : 0)).filter((value) => Number.isFinite(value));
      const atrMean = atrValues.length > 0 ? atrValues.reduce((sum, val) => sum + val, 0) / atrValues.length : 0;

      const bbPositions = displayMarketData.map((item) => {
        const bbRange = Math.max(item.indicators.bb.upper - item.indicators.bb.lower, item.price * 0.0025);
        return clamp((item.price - item.indicators.bb.lower) / bbRange, 0, 1);
      });
      const liquidityEdgePressure = bbPositions.reduce((sum, pos) => sum + (pos <= 0.2 || pos >= 0.8 ? 1 : 0), 0) / bbPositions.length;
      const liquidityCenterBalance = bbPositions.reduce((sum, pos) => sum + (pos >= 0.35 && pos <= 0.65 ? 1 : 0), 0) / bbPositions.length;

      const trendAlignmentStrength = displayMarketData.reduce((sum, item) => {
        const slopeFast = item.price > 0 ? (item.indicators.ema20 - item.indicators.ema50) / item.price : 0;
        const slopeSlow = item.price > 0 ? (item.indicators.ema50 - item.indicators.ema200) / item.price : 0;
        const sameDirection = Math.sign(slopeFast) !== 0 && Math.sign(slopeFast) === Math.sign(slopeSlow);
        return sum + (sameDirection ? Math.min(1, Math.abs(slopeFast) * 280 + Math.abs(slopeSlow) * 220) : 0);
      }, 0) / displayMarketData.length;

      const marketBreadth = ratio(buyCount - sellCount, displayMarketData.length);
      const conditionBreadth = ratio(bullishConditionCount - bearishConditionCount, displayMarketData.length);
      const breadthConsensus = (marketBreadth + conditionBreadth) / 2;

      const hotTrendShare = displayMarketData.reduce((sum, item) => {
        const slopeFast = item.price > 0 ? (item.indicators.ema20 - item.indicators.ema50) / item.price : 0;
        const slopeSlow = item.price > 0 ? (item.indicators.ema50 - item.indicators.ema200) / item.price : 0;
        const momentum = item.indicators.macd.histogram;
        const volumeSupport = avgVolume > 0 ? item.volume24h / avgVolume : 1;
        const trendReady = Math.abs(slopeFast) > 0.002 && Math.abs(slopeSlow) > 0.003 && Math.sign(slopeFast) === Math.sign(momentum);
        return sum + (trendReady && volumeSupport > 0.95 ? 1 : 0);
      }, 0) / displayMarketData.length;

      const exhaustionShare = displayMarketData.reduce((sum, item) => {
        const rsiExtreme = item.indicators.rsi > 72 || item.indicators.rsi < 28;
        const stretchedMove = Math.abs(item.change24h) > 4.5;
        const weakMomentum = Math.sign(item.indicators.macd.histogram) !== Math.sign(item.change24h);
        return sum + (rsiExtreme && stretchedMove && weakMomentum ? 1 : 0);
      }, 0) / displayMarketData.length;

      const squeezeShare = displayMarketData.reduce((sum, item) => {
        const bbRangePct = item.price > 0 ? (item.indicators.bb.upper - item.indicators.bb.lower) / item.price : 0;
        return sum + (bbRangePct < 0.018 ? 1 : 0);
      }, 0) / displayMarketData.length;

      const noiseScore = clamp(volatility / 6.5 + atrMean * 42 + liquidityEdgePressure * 0.6 - hotTrendShare * 0.35, 0, 3);
      const trendScore = clamp(trendAlignmentStrength * 1.2 + hotTrendShare + Math.abs(breadthConsensus) * 0.9 + (volumeIntensity - 1), 0, 4);
      const meanReversionScore = clamp(liquidityCenterBalance + squeezeShare * 1.1 + (1 - Math.abs(breadthConsensus)) * 0.8 - atrMean * 20, 0, 4);

      let state: MarketState = 'WAIT';
      if (volatility >= 5 || avgAbsChange >= 6) {
        state = 'VOLATILE';
      } else if (volumeIntensity >= 1.35 && avgAbsChange >= 2.5 && avgScore >= 62) {
        state = 'VERY_ACTIVE';
      } else if (avgScore >= 70 && volatility >= 1 && volatility <= 4 && volumeIntensity >= 1.1) {
        state = 'IDEAL_TRADING';
      } else if (volatility <= 1.2 && avgAbsChange <= 1.2 && volumeIntensity < 1.05) {
        state = 'CALM';
      }

      let regimeState: MarketRegimeState = 'BALANCED_ROTATION';
      let conclusionKey = 'MARKET_REGIME_MSG_BALANCED_ROTATION';

      if (noiseScore > 2.1 && trendScore < 1.8) {
        regimeState = 'NOISE_STAND_ASIDE';
        conclusionKey = 'MARKET_REGIME_MSG_NOISE_STAND_ASIDE';
      } else if (volatility > 6 || atrMean > 0.032) {
        regimeState = 'PANIC_VOLATILITY';
        conclusionKey = 'MARKET_REGIME_MSG_PANIC_VOLATILITY';
      } else if (trendScore >= 2.45 && volumeIntensity >= 1.18 && Math.abs(breadthConsensus) >= 0.22) {
        regimeState = 'TREND_FOLLOW';
        conclusionKey = 'MARKET_REGIME_MSG_TREND_FOLLOW';
      } else if (hotTrendShare >= 0.34 && exhaustionShare >= 0.22 && avgAbsChange >= 2.8) {
        regimeState = 'TREND_EXHAUSTION';
        conclusionKey = 'MARKET_REGIME_MSG_TREND_EXHAUSTION';
      } else if (squeezeShare >= 0.48 && volumeIntensity >= 1.22 && avgAbsChange >= 1.8) {
        regimeState = 'BREAKOUT_EXPANSION';
        conclusionKey = 'MARKET_REGIME_MSG_BREAKOUT_EXPANSION';
      } else if (meanReversionScore >= 2.2 && Math.abs(breadthConsensus) < 0.2 && avgAbsChange <= 2.4) {
        regimeState = 'MEAN_REVERSION';
        conclusionKey = 'MARKET_REGIME_MSG_MEAN_REVERSION';
      } else if (liquidityEdgePressure >= 0.5 && Math.abs(breadthConsensus) < 0.15 && volatility >= 2.5) {
        regimeState = 'LIQUIDITY_TRAP';
        conclusionKey = 'MARKET_REGIME_MSG_LIQUIDITY_TRAP';
      } else if (volatility <= 1.35 && atrMean <= 0.012 && trendAlignmentStrength >= 0.36) {
        regimeState = 'CALM_STRUCTURED';
        conclusionKey = 'MARKET_REGIME_MSG_CALM_STRUCTURED';
      } else if (avgAbsChange <= 1.6 && volumeIntensity < 1.1 && trendAlignmentStrength < 0.25 && squeezeShare >= 0.35) {
        regimeState = 'ACCUMULATION_PHASE';
        conclusionKey = 'MARKET_REGIME_MSG_ACCUMULATION_PHASE';
      }

      const diagnostics = [
        {
          labelKey: 'MARKET_PANEL_BREADTH',
          value: `${(breadthConsensus * 100).toFixed(0)}%`,
          detail: buyCount >= sellCount ? 'MARKET_PANEL_BREADTH_BUY' : 'MARKET_PANEL_BREADTH_SELL',
        },
        {
          labelKey: 'MARKET_PANEL_TREND',
          value: `${(trendAlignmentStrength * 100).toFixed(0)}%`,
          detail: trendAlignmentStrength >= 0.45 ? 'MARKET_PANEL_TREND_ALIGNED' : 'MARKET_PANEL_TREND_FRAGMENTED',
        },
        {
          labelKey: 'MARKET_PANEL_ORDERFLOW',
          value: `${(liquidityEdgePressure * 100).toFixed(0)}%`,
          detail: liquidityEdgePressure >= 0.45 ? 'MARKET_PANEL_ORDERFLOW_EDGE' : 'MARKET_PANEL_ORDERFLOW_BALANCED',
        },
        {
          labelKey: 'MARKET_PANEL_VOLUME',
          value: `x${volumeIntensity.toFixed(2)}`,
          detail: volumeIntensity >= 1.2 ? 'MARKET_PANEL_VOLUME_EXPANSION' : 'MARKET_PANEL_VOLUME_NORMAL',
        },
      ];

      return {
        state,
        avgAbsChange,
        volatility,
        volumeIntensity,
        regimeState,
        conclusionKey,
        diagnostics,
      };
  }, [displayMarketData]);

  const displayData = useMemo(() => {
      const orderIndex = new Map<string, number>(marketOrder.map((symbol, index) => [symbol, index]));
      return displayMarketData.filter(item => {
          const isFav = favorites.includes(item.symbol);
          if (isFav) return true;
          if (filter === 'ALL') return true;
          if (filter === 'BULL') return item.bias.includes('BUY');
          if (filter === 'BEAR') return item.bias.includes('SELL');
          return false;
      }).sort((a, b) => {
          const aOrder = orderIndex.get(a.symbol) ?? Number.MAX_SAFE_INTEGER;
          const bOrder = orderIndex.get(b.symbol) ?? Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
      });
  }, [displayMarketData, favorites, filter, marketOrder]);

  return (
    <div className="min-h-screen pb-safe transition-colors duration-300">
      <GlobalInteractionLoader visible={isGlobalLoading} />
      <div className={`transition-all duration-300 ${selectedSymbol ? 'opacity-0 pointer-events-none hidden' : 'opacity-100'}`}>
        <header className="sticky top-0 z-40 bg-street-light/90 dark:bg-street-dark/90 backdrop-blur border-b-2 border-black dark:border-white px-4 py-3 shadow-sm">
           <div className="flex justify-between items-center mb-3">
              <h1 className="font-extrabold text-xl tracking-tighter italic flex items-center gap-2">THE<span className="text-street-acid">MIND</span><BrainLoader size="sm" /></h1>
              <div className="flex items-center gap-3">
                  <div className="flex bg-transparent border-2 border-black dark:border-white rounded-lg overflow-hidden h-9">
                      <button onClick={() => handleLangChange('ES')} className={`px-2 text-xs font-bold ${lang === 'ES' ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-gray-500 hover:text-black dark:hover:text-white'}`}>ES</button>
                      <button onClick={() => handleLangChange('EN')} className={`px-2 text-xs font-bold ${lang === 'EN' ? 'bg-black text-white dark:bg-white dark:text-black' : 'text-gray-500 hover:text-black dark:hover:text-white'}`}>EN</button>
                  </div>
                  <button onClick={toggleTheme} className="p-2 border-2 border-transparent hover:border-black dark:hover:border-white rounded-lg transition-all">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
                  <button onClick={toggleSettings} className={`p-2 border-2 border-black dark:border-white rounded-lg shadow-brutal-sm active:shadow-none active:translate-y-1 transition-all ${alertConfig.enabled ? 'bg-street-acid text-black' : 'bg-transparent'}`}><BellIcon /></button>
                  <button onClick={toggleScanning} className={`text-[10px] font-bold px-2 py-2 rounded-lg border-2 border-black dark:border-white shadow-brutal-sm active:shadow-none active:translate-y-1 transition-all ${isScanning ? 'bg-street-acid text-black' : 'bg-street-pink text-white'}`}>{isScanning ? t.LIVE : t.PAUSE}</button>
              </div>
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <div className="flex gap-2">
                <select
                  value={filter}
                  onChange={(e) => handleFilterChange(e.target.value as 'ALL' | 'BULL' | 'BEAR')}
                  className="flex-1 bg-transparent border-2 border-black dark:border-white rounded-lg px-3 py-2 text-xs font-bold uppercase"
                >
                  <option value="ALL">{t.FILTER_ALL}</option>
                  <option value="BULL">{t.FILTER_BULL}</option>
                  <option value="BEAR">{t.FILTER_BEAR}</option>
                </select>
                <button onClick={() => setIsOppositeMode(prev => !prev)} className={`px-3 py-2 text-[10px] font-bold uppercase border-2 rounded-lg transition-all whitespace-nowrap ${isOppositeMode ? 'bg-street-pink text-white border-black dark:border-white' : 'bg-transparent text-gray-600 dark:text-gray-400 border-black/20 dark:border-white/20'}`}>
                  {t.OPPOSITE_MODE}
                </button>
              </div>
              <select
                value={activeTimeframe}
                onChange={(e) => handleTimeframeChange(e.target.value as Timeframe)}
                className="w-full bg-transparent border-2 border-black dark:border-white rounded-lg px-3 py-2 text-xs font-bold uppercase"
              >
                {[Timeframe.M5, Timeframe.M15, Timeframe.H1, Timeframe.H4].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
           </div>
           {marketStatusSummary && (
            <>
              <div className="mt-3 p-2 border-2 border-black/20 dark:border-white/20 rounded-lg bg-street-cardLight dark:bg-street-cardDark">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">{t.MARKET_STATUS}</span>
                  <span className={`text-[10px] px-2 py-1 rounded-full border font-extrabold uppercase tracking-wide ${MARKET_STATE_STYLES[marketStatusSummary.state]}`}>
                    {t[`MARKET_STATE_${marketStatusSummary.state}` as keyof typeof t]}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-bold uppercase">
                  <div className="border border-black/20 dark:border-white/20 rounded p-1.5">
                    <div className="text-gray-500 dark:text-gray-400">{t.MARKET_MOVE}</div>
                    <div className="text-gray-800 dark:text-gray-100">{marketStatusSummary.avgAbsChange.toFixed(2)}%</div>
                  </div>
                  <div className="border border-black/20 dark:border-white/20 rounded p-1.5">
                    <div className="text-gray-500 dark:text-gray-400">{t.MARKET_VOLATILITY}</div>
                    <div className="text-gray-800 dark:text-gray-100">{marketStatusSummary.volatility.toFixed(2)}</div>
                  </div>
                  <div className="border border-black/20 dark:border-white/20 rounded p-1.5">
                    <div className="text-gray-500 dark:text-gray-400">{t.MARKET_VOLUME}</div>
                    <div className="text-gray-800 dark:text-gray-100">x{marketStatusSummary.volumeIntensity.toFixed(2)}</div>
                  </div>
                </div>
              </div>
              <div className="mt-2 p-3 border-2 border-black/20 dark:border-white/20 rounded-lg bg-street-cardLight dark:bg-street-cardDark space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">{t.MARKET_PANEL_TITLE}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full border font-extrabold uppercase tracking-wide ${MARKET_REGIME_STYLES[marketStatusSummary.regimeState]}`}>
                      {t[`MARKET_REGIME_${marketStatusSummary.regimeState}` as keyof typeof t]}
                    </span>
                    <button
                      onClick={() => setIsMarketPanelExpanded((prev) => !prev)}
                      className="text-[10px] px-2 py-1 rounded border border-black/20 dark:border-white/20 font-extrabold uppercase tracking-wide"
                    >
                      {isMarketPanelExpanded ? t.MARKET_PANEL_COLLAPSE : t.MARKET_PANEL_EXPAND}
                    </button>
                  </div>
                </div>
                {isMarketPanelExpanded && (
                  <>
                    <div className="p-2 border border-black/20 dark:border-white/20 rounded-lg bg-black/[0.03] dark:bg-white/[0.02]">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-gray-900 dark:text-gray-100">
                        {t[marketStatusSummary.conclusionKey as keyof typeof t]}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase">
                      {marketStatusSummary.diagnostics.map((diag) => (
                        <div key={diag.labelKey} className="border border-black/20 dark:border-white/20 rounded p-1.5">
                          <div className="text-gray-500 dark:text-gray-400">{t[diag.labelKey as keyof typeof t]}</div>
                          <div className="text-gray-800 dark:text-gray-100 text-xs">{diag.value}</div>
                          <div className="text-[9px] text-gray-500 dark:text-gray-400">{t[diag.detail as keyof typeof t]}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
           )}

        </header>

        <main className="p-4 pb-20 space-y-2 min-h-screen">
           {marketData.length === 0 && isScanning && (
               <div className="flex flex-col items-center justify-center py-24 opacity-80 animate-in fade-in">
                   <BrainLoader size="xl" label={t.SCANNING} />
               </div>
           )}
           {marketData.length > 0 && displayData.length === 0 && (
               <div className="flex flex-col items-center justify-center py-12 text-center opacity-60 animate-in fade-in">
                   <div className="text-4xl mb-2">🔭</div>
                   <h3 className="text-lg font-bold uppercase">{t.NO_SIGNALS}</h3>
                   <p className="text-xs max-w-[200px] mt-1">{t.NO_SIGNALS_DESC}</p>
               </div>
           )}
           {displayData.map(item => (
              <MarketCard key={item.symbol} data={item} isLoading={!!loadingMap[item.symbol]} onClick={() => handleSymbolSelect(item.symbol)} isFavorite={favorites.includes(item.symbol)} onToggleFav={(e) => toggleFavorite(item.symbol, e)} lang={lang} />
           ))}
           <div className="h-12"></div>
        </main>
      </div>

      {selectedSymbol && activeMarket && (
         <div className="fixed inset-0 z-50 bg-street-light dark:bg-street-dark flex flex-col animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-4 border-b-2 border-black dark:border-white">
               <button onClick={() => setSelectedSymbol(null)} className="p-2 -ml-2 hover:bg-black/10 rounded-full"><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg></button>
               <div className="text-center">
                  <h2 className="font-extrabold text-xl italic tracking-tighter leading-none">{selectedSymbol}</h2>
                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">{activeTimeframe} • {t.REALTIME}</span>
               </div>
               <button onClick={handlePredict} disabled={!!loadingMap[selectedSymbol]} className="bg-street-purple text-white border-2 border-black dark:border-white shadow-brutal-sm px-3 py-2 rounded-lg text-xs font-bold active:shadow-none active:translate-y-1 transition-all">{t.PREDICT_BTN}</button>
            </div>
            <div className="flex gap-2 px-4 py-2 border-b-2 border-black/10 dark:border-white/10">
                <select
                  value={chartMode}
                  onChange={(e) => setChartMode(e.target.value as 'line' | 'candles')}
                  className="flex-1 bg-transparent border border-black/20 dark:border-white/20 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                >
                  <option value="line">{t.LINE}</option>
                  <option value="candles">{t.CANDLES}</option>
                </select>
                <button onClick={() => setIsOppositeMode(prev => !prev)} className={`px-3 py-1.5 text-[10px] font-bold uppercase border rounded-md transition-all whitespace-nowrap ${isOppositeMode ? 'bg-street-pink text-white border-black dark:border-white' : 'bg-transparent text-gray-600 dark:text-gray-400 border-black/20 dark:border-white/20'}`}>
                    {t.OPPOSITE_MODE}
                </button>
            </div>
            <div className="px-4 py-2 border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-gray-600 dark:text-gray-300 mb-1.5">{t.HEATMAP_OVERLAYS}</p>
              <select
                value={heatmapOverlayFilter}
                onChange={(e) => setHeatmapOverlayFilter(e.target.value as 'all' | keyof OrderBlockVisibility)}
                className="w-full bg-transparent border border-black/20 dark:border-white/20 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
              >
                <option value="all">{t.HEATMAP_FILTER_ALL}</option>
                <option value="demand">{t.HEATMAP_FILTER_DEMAND}</option>
                <option value="supply">{t.HEATMAP_FILTER_SUPPLY}</option>
                <option value="liquidity">{t.HEATMAP_FILTER_LIQUIDITY}</option>
                <option value="highVolume">{t.HEATMAP_FILTER_HIGH_VOLUME}</option>
              </select>
            </div>
            <div className="flex gap-1.5 px-4 py-2 border-b border-black/10 dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.015]">
              <button
                onClick={() => setDetailViewTab('chart')}
                className={`px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] rounded-full border transition-all ${detailViewTab === 'chart' ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white' : 'bg-transparent text-gray-600 dark:text-gray-400 border-black/15 dark:border-white/20'}`}
              >
                Chart
              </button>
              <button
                onClick={() => setDetailViewTab('heatmap')}
                className={`px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] rounded-full border transition-all ${detailViewTab === 'heatmap' ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white' : 'bg-transparent text-gray-600 dark:text-gray-400 border-black/15 dark:border-white/20'}`}
              >
                Heatmap
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-street-light dark:bg-street-dark">
               {detailViewTab === 'chart' ? (
                 <div className="h-[360px] w-full border-b-2 border-black dark:border-white bg-white/5 relative">
                    <Chart data={chartData} symbol={selectedSymbol} levels={srLevels} orderBlockLevels={orderBlockLevels} theme={theme} mode={chartMode} visibility={orderBlockVisibility} noDataLabel={t.NO_SIGNALS} />
                 </div>
               ) : (
                 <>
                   <div className="h-[360px] w-full border-b-2 border-black dark:border-white bg-[#030712] relative">
                     <OrderBlockHeatmap data={chartData} orderBlockLevels={orderBlockLevels} theme={theme} noDataLabel={t.NO_SIGNALS} />
                   </div>
                   <div className="p-4 border-b-2 border-black/10 dark:border-white/10 space-y-3">
                     <div>
                       <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-700 dark:text-gray-200 mb-1">{t.HEATMAP_DESCRIPTION_TITLE}</h3>
                       <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                         {t.HEATMAP_DESCRIPTION_BODY}
                       </p>
                     </div>
                     <div>
                       <h3 className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-700 dark:text-gray-200 mb-1">{t.HEATMAP_STRUCTURED_ANALYSIS}</h3>
                       {heatmapInsight ? (
                         <div className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                           <p>
                             <span className="font-semibold">{t.HEATMAP_LIQUIDITY_CONCENTRATION}</span> {t.HEATMAP_LONG_PRESSURE} {heatmapInsight.longPressure.toFixed(2)} {t.HEATMAP_VS} {t.HEATMAP_SHORT_PRESSURE} {heatmapInsight.shortPressure.toFixed(2)}.
                           </p>
                           <p>
                             <span className="font-semibold">{t.HEATMAP_IMBALANCE_CLUSTERS}</span> {t.HEATMAP_CURRENT_SKEW} {(heatmapInsight.imbalanceScore * 100).toFixed(0)}%, {heatmapInsight.imbalanceScore > 0.35 ? t.HEATMAP_DIRECTIONAL_TILT : t.HEATMAP_BALANCED_FIELD}.
                           </p>
                           <div>
                             <p className="font-semibold mb-1">{t.HEATMAP_ACTIVE_ZONES} {formatPrice(heatmapInsight.currentPrice)}:</p>
                             <ul className="space-y-1 list-disc pl-4">
                               {heatmapInsight.strongestClusters.map((cluster) => (
                                 <li key={`${cluster.label}-${cluster.price}`}>
                                   {cluster.side} - {cluster.label} {t.HEATMAP_AT} {formatPrice(cluster.price)} ({cluster.distance >= 0 ? '+' : ''}{cluster.distance.toFixed(2)}%) • {t.HEATMAP_STRENGTH} {cluster.strength.toFixed(2)}.
                                 </li>
                               ))}
                             </ul>
                           </div>
                           <p>
                             <span className="font-semibold">{t.HEATMAP_CONTEXTUAL_INSIGHT}</span> {heatmapInsight.contextLine}
                           </p>
                         </div>
                       ) : (
                         <p className="text-xs text-gray-600 dark:text-gray-400">{t.HEATMAP_INSUFFICIENT_DATA}</p>
                       )}
                     </div>
                   </div>
                 </>
               )}
               <div className="grid grid-cols-3 gap-3 p-4">
                  {[
                      { l: 'RSI', v: activeMarket.indicators.rsi.toFixed(0), c: activeMarket.indicators.rsi > 70 ? 'text-pink-600 dark:text-street-pink' : activeMarket.indicators.rsi < 30 ? 'text-green-600 dark:text-street-acid' : '' },
                      { l: <span className="inline-flex items-center gap-1">{t.SCORE} <AnalyticTermHelp term="SCORE" lang={lang} /></span>, v: Math.round(activeMarket.score), c: 'text-street-cyan' },
                      { l: t.VOL, v: `${(activeMarket.volume24h / 1000).toFixed(0)}k`, c: '' }
                  ].map((s, i) => (
                      <div key={i} className="bg-street-cardLight dark:bg-street-cardDark p-2 rounded-lg border-2 border-black dark:border-white text-center shadow-brutal-sm">
                          <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400">{s.l}</div>
                          <div className={`text-lg font-mono font-bold ${s.c || 'text-gray-800 dark:text-gray-200'}`}>{s.v}</div>
                      </div>
                  ))}
               </div>
               <div className="px-4 pb-4">
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">{t.DRIVERS}</h3>
                  <div className="flex flex-wrap gap-2">
                     {activeMarket.reasons.map((r, i) => (
                        <span key={i} className="bg-transparent border-2 border-black dark:border-white/20 rounded px-2 py-1 text-[10px] font-bold uppercase text-gray-700 dark:text-gray-300">{translateReason(r, lang)}</span>
                     ))}
                  </div>
               </div>
               <div className="px-4 pb-4">
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400 mb-2">{t.EARLY_SIGNAL}</h3>
                  {activeMarket.earlySignal.side === 'NEUTRAL' ? (
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t.NO_EARLY_SIGNAL}</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase">
                        <span className={`${activeMarket.earlySignal.side === 'LONG' ? 'text-green-700 dark:text-street-acid' : 'text-pink-600 dark:text-street-pink'}`}>
                          {activeMarket.earlySignal.side === 'LONG' ? t.EARLY_LONG : t.EARLY_SHORT}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">{t.CERTAINTY}: {activeMarket.earlySignal.confidence}%</span>
                      </div>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        <span className="font-bold uppercase text-gray-500 dark:text-gray-400 mr-2">{t.WHY}:</span>
                        {activeMarket.earlySignal.reasons.map((reason) => translateReason(reason, lang)).join(' · ')}
                      </p>
                    </div>
                  )}
               </div>
               {activeMarket.institutional && (
                <div className="mx-4 mb-4 p-4 border-2 border-black dark:border-white rounded-xl bg-street-cardLight dark:bg-street-cardDark shadow-brutal-sm">
                  <h3 className="text-xs font-black uppercase tracking-wide mb-2">🏛️ Institutional Dashboard</h3>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                    <div>Regime: <span className="font-black">{activeMarket.institutional.regime.replaceAll('_', ' ')}</span></div>
                    <div>Institutional Score: <span className="font-black">{activeMarket.institutional.score}/100</span></div>
                    <div>Quality: <span className="font-black">{activeMarket.institutional.quality.replaceAll('_', ' ')}</span></div>
                    <div>OI State: <span className="font-black">{activeMarket.institutional.oiState.replaceAll('_', ' ')}</span></div>
                    <div>Volatility: <span className="font-black">{activeMarket.institutional.volatilityState}</span></div>
                    <div>Bias: <span className="font-black">{activeMarket.institutional.bias}</span></div>
                    <div>Trade Allowed: <span className="font-black">{activeMarket.institutional.tradeAllowed ? 'YES' : 'NO'}</span></div>
                    <div>Sweep: <span className="font-black">{activeMarket.institutional.sweep ? `${activeMarket.institutional.sweep.side} CONFIRMED` : 'NONE'}</span></div>
                  </div>
                  {activeMarket.institutional.smartEntry && (
                    <div className="mt-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                      Smart Entry → {activeMarket.institutional.smartEntry.side} | Entry {formatPrice(activeMarket.institutional.smartEntry.entry)} | SL {formatPrice(activeMarket.institutional.smartEntry.stopLoss)} | TP {formatPrice(activeMarket.institutional.smartEntry.takeProfit)} | RR {activeMarket.institutional.smartEntry.rr.toFixed(2)} | Size {activeMarket.institutional.smartEntry.sizePct}%
                    </div>
                  )}
                </div>
               )}
               {activeMarket.perfectTrade && (
                <div className={`mx-4 mb-4 p-4 border-2 rounded-xl relative overflow-hidden ${activeMarket.perfectTrade.active ? 'border-yellow-400 bg-yellow-100/50 dark:bg-yellow-500/10 animate-pulse' : 'border-black dark:border-white bg-transparent'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-black uppercase tracking-wide">⭐ {t.PERFECT_TRADE} <AnalyticTermHelp term="PERFECT_TRADE" lang={lang} /></h3>
                    <span className="text-[10px] font-bold uppercase text-gray-600 dark:text-gray-300">
                      {activeMarket.perfectTrade.active ? t.PERFECT_TRADE_CONFIRMED : t.PERFECT_TRADE_BUILDING}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 space-y-1">
                    <div><span className="inline-flex items-center gap-1">{t.CONFLUENCE_SCORE}: <AnalyticTermHelp term="CONFLUENCE" lang={lang} /></span> {activeMarket.perfectTrade.confluenceScore}/100 • <span className="inline-flex items-center gap-1">{t.ROBUST_SCORE}: <AnalyticTermHelp term="ROBUST" lang={lang} /></span> {Math.round(activeMarket.perfectTrade.robustScore)}/{activeMarket.perfectTrade.threshold}</div>
                    <div>{t.STABILITY}: {activeMarket.perfectTrade.stabilityMinutes.toFixed(1)}m / {activeMarket.perfectTrade.holdMinutes.toFixed(1)}m • RR: {activeMarket.perfectTrade.rr.toFixed(2)}</div>
                    <div>{t.KEY_LEVELS} → TP: {activeMarket.perfectTrade.tp ? `$${formatPrice(activeMarket.perfectTrade.tp)}` : '---'} • SL: {activeMarket.perfectTrade.sl ? `$${formatPrice(activeMarket.perfectTrade.sl)}` : '---'}</div>
                  </div>
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{t.WHY_PERFECT}</p>
                    <ul className="space-y-1">
                      {activeMarket.perfectTrade.summary.map((line, i) => (
                        <li key={`star-sum-${i}`} className="text-[11px] text-gray-700 dark:text-gray-200">• {getPerfectTradeLine(line, lang, activeMarket.perfectTrade!)}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">{t.EXPECTATIONS}</p>
                    <ul className="space-y-1">
                      {activeMarket.perfectTrade.expectations.map((line, i) => (
                        <li key={`star-exp-${i}`} className="text-[11px] text-gray-700 dark:text-gray-200">• {getPerfectTradeLine(line, lang, activeMarket.perfectTrade!)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
               )}
               <div className="mx-4 mb-8 p-4 border-2 border-black dark:border-white bg-gradient-to-br from-street-acid/20 to-transparent rounded-xl shadow-brutal relative overflow-hidden">
                   <div className="flex justify-between items-start mb-2 relative z-10"><h3 className="font-bold text-sm uppercase flex items-center gap-2">🤖 {t.AI_ANALYSIS}</h3></div>
                   {!aiAnalysis && !isAnalyzing && (
                       <div className="relative z-10">
                           <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-4">{t.AI_PROMPT}</p>
                           <button onClick={handleAI} className="w-full py-3 bg-black dark:bg-white text-white dark:text-black font-bold text-sm uppercase rounded border-2 border-transparent active:scale-[0.98] transition-all">{t.AI_BTN}</button>
                       </div>
                   )}
                   {isAnalyzing && <div className="py-8 flex flex-col items-center justify-center relative z-10"><BrainLoader size="lg" label={t.PROCESSING} /></div>}
                   {aiAnalysis && !isAnalyzing && (
                       <div className="relative z-10 animate-in fade-in">
                           <p className="text-sm font-medium leading-relaxed font-mono text-gray-800 dark:text-gray-200">{aiAnalysis}</p>
                           <button onClick={handleAI} className="mt-4 text-xs font-bold uppercase underline text-gray-500">{t.AI_UPDATE}</button>
                       </div>
                   )}
               </div>
               <div className="h-12"></div>
            </div>
         </div>
      )}

      <ModalWrapper isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title={t.CONFIG_TITLE}>
          <SettingsContent
            config={alertConfig}
            setConfig={setAlertConfig}
            isOppositeMode={isOppositeMode}
            onToggleOppositeMode={() => setIsOppositeMode(prev => !prev)}
            onClearKeys={clearKeys}
            lang={lang}
          />
      </ModalWrapper>
      <ModalWrapper isOpen={isPredictionModalOpen} onClose={() => setIsPredictionModalOpen(false)} title={t.PREDICT_TITLE} color={predictionResult?.bias === 'ALCISTA' ? 'border-green-600 dark:border-street-acid' : predictionResult?.bias === 'BAJISTA' ? 'border-pink-600 dark:border-street-pink' : ''}>
          {predictionResult && <PredictionContent result={predictionResult} currentPrice={activeMarket?.price ?? null} onClose={() => setIsPredictionModalOpen(false)} onOpenPosition={handleOpenPositionFlow} lang={lang} />}
      </ModalWrapper>
      <ModalWrapper isOpen={isKeyModalOpen} onClose={() => setIsKeyModalOpen(false)} title={t.KEYS_TITLE}>
          <CoinExKeyModal onSave={saveKeys} onClose={() => setIsKeyModalOpen(false)} lang={lang} />
      </ModalWrapper>
      <ModalWrapper isOpen={isPositionConfirmOpen} onClose={() => setIsPositionConfirmOpen(false)} title={t.CONFIRM_TITLE}>
          {predictionResult && <PositionConfirmationModal prediction={predictionResult} onConfirm={executeHandoff} onCancel={() => setIsPositionConfirmOpen(false)} lang={lang} />}
      </ModalWrapper>
    </div>
  );
}
