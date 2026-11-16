import { config } from "./config.mjs";

/**
 * Cliente de la API de Google AI Studio (Gemini) con la GEMINI_API_KEY.
 * Hoy lo usa el RAG (embeddings — ver embeddings.mjs); el análisis de los
 * informes lo genera OpenAI (openai.mjs).
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/**
 * POST a la API de Gemini con la GEMINI_API_KEY. `metodo` es la ruta del
 * endpoint sin la base (p. ej. "models/gemini-embedding-001:embedContent").
 * Exportada: embeddings.mjs la usa para los embeddings del RAG.
 */
export async function postGemini(metodo, cuerpo) {
  const res = await fetch(`${API}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.gemini.apiKey },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) {
    let detalle = "";
    try {
      detalle = (await res.json())?.error?.message ?? "";
    } catch {
      detalle = (await res.text().catch(() => "")).slice(0, 300);
    }
    const e = new Error(`Gemini respondió HTTP ${res.status}: ${detalle}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}
