
import { GoogleGenAI, Type } from "@google/genai";
import { PriceEntry } from "../types";

export const extractPricesFromDocument = async (
  base64Data: string,
  mimeType: string
): Promise<PriceEntry[]> => {
  // Initialize the Google GenAI client right before use
  const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
  
  try {
    // Use gemini-3-pro-preview for complex extraction tasks as per guidelines
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: "Extrahiere eine Liste aller Produkte und deren Netto-Einkaufspreise (EK) aus diesem Dokument. Gib nur ein JSON-Array zurück, wobei jedes Objekt die Felder 'product' (String) und 'price' (Number) enthält. Verwende Punkt statt Komma für Dezimalzahlen. Ignoriere Steuern oder Rabatte, nimm den Basis-Einkaufspreis.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              product: { type: Type.STRING, description: "Der Name des Artikels" },
              price: { type: Type.NUMBER, description: "Der Einkaufspreis als reine Zahl" },
            },
            required: ["product", "price"],
            propertyOrdering: ["product", "price"],
          },
        },
      },
    });

    // Extracting text output from GenerateContentResponse using the .text property directly.
    const text = response.text;
    if (!text) return [];
    
    // Parse the JSON string directly from the text property
    return JSON.parse(text.trim()) as PriceEntry[];
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw error;
  }
};
