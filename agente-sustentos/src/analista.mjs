import { config } from "./config.mjs";
import { consultarGemini, consultarGeminiResumen } from "./gemini.mjs";
import { consultarMaas, consultarMaasResumen } from "./maas-llm.mjs";

/**
 * Dispatcher del análisis IA (veredictos de registros + resumen ejecutivo de
 * los envíos): la variable IA_PROVEEDOR elige quién genera los INFORMES —
 *
 *   IA_PROVEEDOR=maas   → MaaS de Huawei (ModelArts Studio), PRODUCCIÓN:
 *                          chat compatible con OpenAI. Requiere MAAS_API_KEY,
 *                          MAAS_BASE_URL y MAAS_ANALISIS_MODEL.
 *   IA_PROVEEDOR=gemini → Google AI Studio, PRUEBAS: la GEMINI_API_KEY
 *                          (gemini-3.1-flash-lite).
 *
 * (default: "maas"; cualquier otro valor cae a "maas" — ver config.mjs.)
 *
 * Separado del proveedor de EMBEDDINGS del RAG (MAAS_PROVEEDOR, spec 002):
 * cada cosa va con el proveedor que la soporte — hoy el MaaS de Huawei
 * (CN-Hong Kong) es solo de chat, así que los embeddings siguen con Gemini.
 *
 * Quien analiza registros (analizar.mjs, cli.mjs, lote.mjs) solo conoce
 * consultarAnalista/consultarAnalistaResumen: cambiar de proveedor es
 * cambiar la variable, nada más.
 */

export const esMaas = () => config.proveedorIA === "maas";

/** Modelo por defecto del proveedor activo (el CLI puede sobreescribirlo con
 *  --modelo). */
export function modeloAnalista() {
  return esMaas() ? config.maas.modeloAnalisis : config.modelo;
}

/** ¿El proveedor activo tiene credenciales? (para pruebas y mensajes claros;
 *  el flujo principal degrada por sí solo — ver cada módulo.) */
export function analistaConfigurado() {
  return esMaas()
    ? Boolean(config.maas.apiKey && config.maas.baseUrl && config.maas.modeloAnalisis)
    : Boolean(config.apiKey);
}

/** Qué falta para el proveedor activo, en claro (lo muestran los errores). */
export function mensajeAnalistaNoConfigurado() {
  return esMaas()
    ? "Análisis IA sin configurar: el MaaS de Huawei necesita MAAS_API_KEY, MAAS_BASE_URL (el access point del despliegue) y MAAS_ANALISIS_MODEL en agente-sustentos/.env."
    : "Análisis IA sin configurar: falta GEMINI_API_KEY en agente-sustentos/.env (créala en aistudio.google.com) — o configura el MaaS de Huawei con IA_PROVEEDOR=maas.";
}

/** Veredicto de un registro con sus archivos de sustento (ver gemini.mjs /
 *  maas-llm.mjs para lo que hace cada proveedor). */
export async function consultarAnalista({ registro, archivos, modelo }) {
  const m = modelo ?? modeloAnalista();
  return esMaas()
    ? consultarMaas({ registro, archivos, modelo: m })
    : consultarGemini({ registro, archivos, modelo: m });
}

/** Resumen ejecutivo del envío completo. */
export async function consultarAnalistaResumen({ colaborador, fecha, resultados, modelo, contexto = [] }) {
  const m = modelo ?? modeloAnalista();
  return esMaas()
    ? consultarMaasResumen({ colaborador, fecha, resultados, modelo: m, contexto })
    : consultarGeminiResumen({ colaborador, fecha, resultados, modelo: m, contexto });
}
