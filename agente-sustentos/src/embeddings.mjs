import { config } from "./config.mjs";
import { postGemini } from "./gemini.mjs";

/**
 * Adaptador de embeddings del RAG (spec 002): Google AI Studio (Gemini) con
 * la GEMINI_API_KEY — modelo default gemini-embedding-001 a 1024 dims (la
 * dimensionalidad del índice ya existente en Storage). ÚNICA costura con el
 * proveedor: si el endpoint real difiere, se cambia solo el interior de
 * `incrustar` y nada más.
 *
 * Configuración (agente-sustentos/.env o variables de entorno):
 *   GEMINI_API_KEY          — clave de la API (aistudio.google.com)
 *   GEMINI_EMBEDDING_MODEL  — modelo de embeddings (default gemini-embedding-001)
 *   GEMINI_EMBEDDING_DIMS   — dimensión de los vectores (default 1024; solo
 *                             informativa: el índice vive en Storage)
 *
 * Sin GEMINI_API_KEY, `embeddingsConfigurados()` es false y todo el RAG se omite.
 */

export function embeddingsConfigurados() {
  return Boolean(config.gemini.apiKey);
}

/** Mensaje claro cuando falta la clave (para errores y logs). */
export function mensajeNoConfigurado() {
  return "Embeddings no configurados: falta GEMINI_API_KEY en agente-sustentos/.env (créala en aistudio.google.com → \"Get API key\").";
}

async function conReintentos(fn, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transitorio =
        [429, 500, 503, 504].includes(e?.status) ||
        /overloaded|unavailable|fetch failed|timeout|RESOURCE_EXHAUSTED/i.test(e?.message ?? "");
      if (!transitorio || i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    }
  }
}

/**
 * Convierte textos en vectores (embeddings) con Gemini (embedContent, uno por
 * texto). Devuelve un array de vectores en el mismo orden de entrada.
 * `tarea` ("documento" | "consulta"): task types RETRIEVAL_DOCUMENT /
 * RETRIEVAL_QUERY — adaptan el vector a indexar o a buscar (mejora la
 * recuperación del RAG).
 */
export async function incrustar(textos, { modelo, tarea } = {}) {
  if (!Array.isArray(textos) || textos.length === 0) return [];
  if (!embeddingsConfigurados()) {
    throw new Error(mensajeNoConfigurado());
  }
  const m = modelo ?? config.gemini.modelo;
  const taskType = tarea === "consulta" ? "RETRIEVAL_QUERY" : tarea === "documento" ? "RETRIEVAL_DOCUMENT" : undefined;
  const vectores = [];
  for (const [i, texto] of textos.entries()) {
    const cuerpo = { content: { parts: [{ text: String(texto ?? "") }] }, output_dimensionality: config.gemini.dims };
    if (taskType) cuerpo.task_type = taskType;
    const r = await conReintentos(() => postGemini(`models/${m}:embedContent`, cuerpo));
    const valores = r?.embedding?.values;
    if (!Array.isArray(valores) || valores.length === 0) {
      throw new Error(`Gemini no devolvió un embedding válido (modelo ${m}).`);
    }
    vectores.push(valores);
    // Pacing: la capa gratuita de Gemini limita las peticiones por minuto;
    // al indexar un informe (decenas de fragmentos) hay que ir con calma.
    if (i < textos.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  return vectores;
}
