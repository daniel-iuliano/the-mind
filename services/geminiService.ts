import { GoogleGenAI } from "@google/genai";
import { MarketAnalysis } from "../types";
import { Language } from "./i18n";
import { formatPrice } from "../utils/formatters";

export const generateAIAnalysis = async (analysis: MarketAnalysis, lang: Language): Promise<string> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return lang === 'ES' ? "Falta la API Key." : "API Key missing.";

    const ai = new GoogleGenAI({ apiKey });
    
    // Construct prompt based on language
    let prompt = "";
    if (lang === 'ES') {
         prompt = `
          Actuá como un Analista de Mercado Crypto Senior, experto en el mercado argentino.
          Analizá los siguientes datos técnicos para ${analysis.symbol}:
          - Precio: $${formatPrice(analysis.price)}
          - Puntaje Técnico: ${analysis.score.toFixed(0)}/100
          - Tendencia/Sesgo: ${analysis.bias}
          - RSI: ${analysis.indicators.rsi.toFixed(2)}
          - Histograma MACD: ${analysis.indicators.macd.histogram.toFixed(4)}
          
          Dame un resumen conciso de 3 oraciones sobre la estructura del mercado y el setup de trading.
          Respondé en ESPAÑOL RIOPLATENSE (ARGENTINO), usando un tono profesional pero directo (podés usar 'voseo').
          NO des consejos financieros. Enfocate en las probabilidades y el setup técnico.
        `;
    } else {
         prompt = `
          Act as a Senior Crypto Market Analyst.
          Analyze the following technical data for ${analysis.symbol}:
          - Price: $${formatPrice(analysis.price)}
          - Technical Score: ${analysis.score.toFixed(0)}/100
          - Trend/Bias: ${analysis.bias}
          - RSI: ${analysis.indicators.rsi.toFixed(2)}
          - MACD Histogram: ${analysis.indicators.macd.histogram.toFixed(4)}
          
          Provide a concise 3-sentence summary of the market structure and trading setup.
          Respond in ENGLISH, using a professional, direct tone.
          DO NOT give financial advice. Focus on probabilities and technical setup.
        `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || (lang === 'ES' ? "Análisis no disponible." : "Analysis not available.");
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    
    // Extract error details if possible
    const errorCode = error?.status || error?.code || error?.error?.code;
    const errorMessage = error?.message || error?.error?.message || "";

    // Handle 404/Not Found specifically for Key Re-selection
    if (errorMessage.includes('Requested entity was not found') || errorCode === 404) {
        throw error;
    }

    if (errorCode === 429 || errorCode === 'RESOURCE_EXHAUSTED' || errorMessage.includes('429') || errorMessage.includes('quota')) {
        return lang === 'ES' 
            ? "⚠️ Límite de cuota excedido (429). La IA está descansando." 
            : "⚠️ Quota exceeded (429). AI is resting.";
    }

    return lang === 'ES' 
        ? "El análisis con IA no está disponible temporalmente." 
        : "AI analysis temporarily unavailable.";
  }
};
