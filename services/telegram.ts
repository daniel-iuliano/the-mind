import { MarketAnalysis, AlertConfig, SignalBias, PredictionResult } from "../types";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export const testTelegramConnection = async (token: string, chatId: string): Promise<boolean> => {
  try {
    const url = `${TELEGRAM_API_BASE}${token}/getMe`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return false;

    // Send a test message
    await sendTelegramMessage(token, chatId, "🔌 QuantMind: Conexión de Alertas Exitosa.");
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
  prediction: PredictionResult | null = null
): string => {
  const isBuy = analysis.bias.includes('BUY');
  const emoji = isBuy ? '🚀' : '🔻';
  const colorCircle = isBuy ? '🟢' : '🔴';
  
  // Format Reasons as bullet points
  const reasonList = analysis.reasons.map(r => `• ${r}`).join('\n');

  let message = `
${emoji} <b>QUANTMIND ALERT</b> ${emoji}

${colorCircle} <b>${analysis.symbol}</b>
⏱ <b>Timeframe:</b> ${timeframe}
🧭 <b>Signal:</b> ${analysis.bias}
💯 <b>Score:</b> ${Math.round(analysis.score)}/100

📊 <b>Key Data:</b>
• Price: $${analysis.price}
• RSI: ${analysis.indicators.rsi.toFixed(1)}
• Vol 24h: $${(analysis.volume24h / 1000).toFixed(0)}k

📝 <b>Drivers:</b>
${reasonList}`;

  // Append Prediction Section if available
  if (prediction) {
    message += `

🔮 <b>PREDICT MODE</b>
🎲 <b>Probabilidad:</b> ${prediction.probability}%
🎯 <b>Target:</b> ${prediction.targetPrice ? '$' + prediction.targetPrice.toFixed(prediction.targetPrice < 1 ? 4 : 2) : 'N/A'}
🛑 <b>Stop Loss:</b> ${prediction.stopLoss ? '$' + prediction.stopLoss.toFixed(prediction.stopLoss < 1 ? 4 : 2) : 'N/A'}

⚠️ <i>Outlook probabilístico. No es consejo financiero.</i>`;
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
     const hasVolumeSpike = analysis.reasons.some(r => r.includes("Volumen"));
     if (!hasVolumeSpike && analysis.score < threshold) return false;
  }

  // Basic Score Check if no specific event overrides
  if (analysis.score < threshold) return false;

  return true;
};