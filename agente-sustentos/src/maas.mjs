import OpenAI from "openai";
import { config } from "./config.mjs";
import { postGemini } from "./gemini.mjs";

/**
 * Adaptador de embeddings del RAG (spec 002). ÚNICA costura con el proveedor:
 * si el endpoint real difiere, se cambia solo el interior de `incrustar` y
 * nada más.
 *
 * Dos proveedores:
 *   - "maas" (default): MaaS de Huawei (ModelArts Studio) — el objetivo de
 *     producción. API de embeddings compatible con OpenAI: requiere MAAS_API_KEY
 *     y MAAS_BASE_URL (el access point del despliegue MaaS, propio de cada uno).
 *   - "gemini": Google AI Studio, para PRUEBAS mientras llegan las credenciales
 *     del MaaS: reusa la GEMINI_API_KEY que ya está en .env (modelo default
 *     gemini-embedding-001, 1024 dimensiones — las mismas que bge-m3).
 *
 * Configuración (agente-sustentos/.env o variables de entorno):
 *   MAAS_PROVEEDOR        — "maas" (default) o "gemini"
 *   MAAS_API_KEY          — API key del MaaS (obligatoria con maas)
 *   MAAS_BASE_URL         — access point del despliegue MaaS (obligatorio con maas)
 *   MAAS_EMBEDDING_MODEL  — modelo de embeddings (default: bge-m3 con maas,
 *                           gemini-embedding-001 con gemini)
 *   MAAS_EMBEDDING_DIMS   — dimensión de los vectores (default 1024; solo
 *                           informativa: el índice vive en Storage, no hay
 *                           columna que deba coincidir)
 *
 * Sin credenciales del proveedor activo, `maasConfigurado()` es false y todo
 * el RAG se omite.
 */

const esGemini = () => config.maas.proveedor === "gemini";

export function maasConfigurado() {
  if (esGemini()) return Boolean(config.apiKey);
  return Boolean(config.maas.apiKey && config.maas.baseUrl);
}

/** Mensaje claro según el proveedor activo (para errores y logs). */
export function mensajeNoConfigurado() {
  return esGemini()
    ? "Embeddings no configurados: MAAS_PROVEEDOR=gemini necesita GEMINI_API_KEY en agente-sustentos/.env (créala en aistudio.google.com)."
    : "Embeddings no configurados: define MAAS_API_KEY y MAAS_BASE_URL (el access point de tu despliegue " +
        "MaaS de Huawei) en agente-sustentos/.env, o pon MAAS_PROVEEDOR=gemini para probar con la clave de Gemini.";
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

/** Embeddings con Gemini (embedContent, uno por texto). */
async function incrustarGemini(textos, modelo, tarea) {
  const m = modelo ?? config.maas.modelo;
  // Task types de Gemini: adaptan el vector a indexar documentos o a buscar
  // consultas (mejora la recuperación del RAG).
  const taskType = tarea === "consulta" ? "RETRIEVAL_QUERY" : tarea === "documento" ? "RETRIEVAL_DOCUMENT" : undefined;
  const vectores = [];
  for (const [i, texto] of textos.entries()) {
    const cuerpo = { content: { parts: [{ text: String(texto ?? "") }] }, output_dimensionality: config.maas.dims };
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

/**
 * Convierte textos en vectores (embeddings) con el proveedor activo.
 * Devuelve un array de vectores en el mismo orden de entrada.
 * `tarea` ("documento" | "consulta", solo con gemini): adapta el embedding a
 * indexar o a buscar (task types RETRIEVAL_*).
 */
export async function incrustar(textos, { modelo, tarea } = {}) {
  if (!Array.isArray(textos) || textos.length === 0) return [];
  if (!maasConfigurado()) {
    throw new Error(mensajeNoConfigurado());
  }
  if (esGemini()) return incrustarGemini(textos, modelo, tarea);
  // MaaS de Huawei: API de embeddings compatible con OpenAI.
  const cliente = new OpenAI({ apiKey: config.maas.apiKey, baseURL: config.maas.baseUrl });
  const respuesta = await conReintentos(() =>
    cliente.embeddings.create({ model: modelo ?? config.maas.modelo, input: textos }),
  );
  const data = Array.isArray(respuesta?.data) ? respuesta.data : [];
  if (data.length !== textos.length) {
    throw new Error(`El proveedor de embeddings devolvió ${data.length} embedding(s) para ${textos.length} texto(s).`);
  }
  // Ordenar por index: la API no garantiza el orden del array.
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
