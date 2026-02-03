import { GoogleGenAI } from "@google/genai";
import { MarketAnalysis } from "../types";

export const generateAIAnalysis = async (analysis: MarketAnalysis): Promise<string> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return "Falta la API Key. No se puede generar el análisis.";

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
      Actuá como un Analista de Mercado Crypto Senior, experto en el mercado argentino.
      Analizá los siguientes datos técnicos para ${analysis.symbol}:
      - Precio: $${analysis.price.toFixed(2)}
      - Puntaje Técnico: ${analysis.score.toFixed(0)}/100
      - Tendencia/Sesgo: ${analysis.bias}
      - RSI: ${analysis.indicators.rsi.toFixed(2)}
      - Histograma MACD: ${analysis.indicators.macd.histogram.toFixed(4)}
      - Drivers Clave: ${analysis.reasons.join(", ")}
      
      Dame un resumen conciso de 3 oraciones sobre la estructura del mercado y el setup de trading.
      Respondé en ESPAÑOL RIOPLATENSE (ARGENTINO), usando un tono profesional pero directo (podés usar 'voseo').
      NO des consejos financieros. Enfocate en las probabilidades y el setup técnico.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Análisis no disponible.";
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
        return "⚠️ Límite de cuota excedido (429). La IA está descansando un toque. Probá de nuevo en un ratito.";
    }

    return "El análisis con IA no está disponible temporalmente por problemas de conexión.";
  }
};