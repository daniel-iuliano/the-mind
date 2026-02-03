import { MarketAnalysis, AlertConfig, SignalBias, PredictionResult } from "../types";
import { TRANSLATIONS, translateReason, Language } from "./i18n";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export const testTelegramConnection = async (token: string, chatId: string, lang: Language): Promise<boolean> => {
  try {
    const url = `${TELEGRAM_API_BASE}${token}/getMe`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return false;

    // Send a test message
    const msg = lang === 'ES' ? "🔌 QuantMind: Conexión de Alertas Exitosa." : "🔌 QuantMind: Alerts Connected Successfully.";
    await sendTelegramMessage(token, chatId, msg);
    return true;
  } catch (e) {
    console.error("Telegram connection failed", e);
    return false;
  }
};

export const sendTelegramMessage = async (token: string, chatId: string, text: string) => {
  try {
    const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error("Failed to send Telegram message", e);
  }
};

export const formatAlertMessage = (
  analysis: MarketAnalysis, 
  timeframe: string,
  prediction: PredictionResult | null,
  lang: Language
): string => {
  const t = TRANSLATIONS[lang];
  const isBuy = analysis.bias.includes('BUY');
  const emoji = isBuy ? '🚀' : '🔻';
  const colorCircle = isBuy ? '🟢' : '🔴';
  
  // Format Reasons as bullet points, translated
  const reasonList = analysis.reasons.map(r => `• ${translateReason(r, lang)}`).join('\n');

  let message = `
${emoji} <b>${t.ALERT_HEADER}</b> ${emoji}

${colorCircle} <b>${analysis.symbol}</b>
⏱ <b>${t.ALERT_TIMEFRAME}:</b> ${timeframe}
🧭 <b>${t.ALERT_SIGNAL}:</b> ${analysis.bias}
💯 <b>${t.ALERT_SCORE}:</b> ${Math.round(analysis.score)}/100

📊 <b>Key Data:</b>
• ${t.ALERT_PRICE}: $${analysis.price}
• RSI: ${analysis.indicators.rsi.toFixed(1)}
• ${t.VOL} 24h: $${(analysis.volume24h / 1000).toFixed(0)}k

📝 <b>${t.ALERT_DRIVERS}:</b>
${reasonList}`;

  // Append Prediction Section if available
  if (prediction) {
    message += `

🔮 <b>${t.ALERT_PREDICT}</b>
🎲 <b>${t.ALERT_PROB}:</b> ${prediction.probability}%
🎯 <b>Target:</b> ${prediction.targetPrice ? '$' + prediction.targetPrice.toFixed(prediction.targetPrice < 1 ? 4 : 2) : 'N/A'}
🛑 <b>Stop Loss:</b> ${prediction.stopLoss ? '$' + prediction.stopLoss.toFixed(prediction.stopLoss < 1 ? 4 : 2) : 'N/A'}

⚠️ <i>${t.ALERT_OUTLOOK}</i>`;
  }

  message += `

<i>${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</i>`;

  return message;
};

export const shouldSendAlert = (
  analysis: MarketAnalysis, 
  config: AlertConfig, 
  lastAlertTime: number
): boolean => {
  if (!config.enabled || !config.telegramToken || !config.telegramChatId) return false;

  // 1. Throttle Check
  const now = Date.now();
  const throttleMs = config.throttleMinutes * 60 * 1000;
  if (now - lastAlertTime < throttleMs) return false;

  // 2. Signal Type Check
  const isBuy = analysis.bias.includes('BUY');
  const isSell = analysis.bias.includes('SELL');
  if (isBuy && !config.signals.buy) return false;
  if (isSell && !config.signals.sell) return false;
  if (analysis.bias === SignalBias.NEUTRAL) return false;

  // 3. Sensitivity (Score Threshold)
  let threshold = 75; // Medium default
  if (config.sensitivity === 'LOW') threshold = 85; // Strict
  if (config.sensitivity === 'HIGH') threshold = 60; // Loose
  
  // If "High Score" event is enabled, strictly check score
  if (config.events.highScore && analysis.score < threshold) return false;

  // 4. Specific Event Logic (Overrides score if critical?)
  // For simplicity, we require the score to meet threshold AND specific events if checked
  if (config.events.volumeSpike) {
     const hasVolumeSpike = analysis.reasons.some(r => r.includes("VOL"));
     if (!hasVolumeSpike && analysis.score < threshold) return false;
  }

  // Basic Score Check if no specific event overrides
  if (analysis.score < threshold) return false;

  return true;
};