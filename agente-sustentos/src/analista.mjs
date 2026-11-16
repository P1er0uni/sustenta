import { config } from "./config.mjs";
import { consultarOpenAI, consultarOpenAIResumen } from "./openai.mjs";

/**
 * Dispatcher del análisis IA (veredictos de registros + resumen ejecutivo de
 * los envíos): los informes los genera OpenAI (openai.mjs, API Responses con
 * structured outputs) con la OPENAI_API_KEY.
 *
 * Separado del proveedor de EMBEDDINGS del RAG (Gemini — ver embeddings.mjs):
 * cada cosa va con el proveedor que la soporta.
 *
 * Quien analiza registros (analizar.mjs, cli.mjs, lote.mjs) solo conoce
 * consultarAnalista/consultarAnalistaResumen: cambiar de proveedor es
 * cambiar el módulo al que apuntan estas funciones, nada más.
 */

/** Modelo por defecto del análisis (el CLI puede sobreescribirlo con --modelo). */
export function modeloAnalista() {
  return config.openai.modelo;
}

/** ¿El análisis tiene credenciales? (para pruebas y mensajes claros; el
 *  flujo principal degrada por sí solo — ver cada módulo.) */
export function analistaConfigurado() {
  return Boolean(config.openai.apiKey);
}

/** Qué falta, en claro (lo muestran los errores). */
export function mensajeAnalistaNoConfigurado() {
  return "Análisis IA sin configurar: falta OPENAI_API_KEY en agente-sustentos/.env (créala en platform.openai.com → API keys).";
}

/** Veredicto de un registro con sus archivos de sustento (ver openai.mjs). */
export async function consultarAnalista({ registro, archivos, modelo }) {
  return consultarOpenAI({ registro, archivos, modelo: modelo ?? modeloAnalista() });
}

/** Resumen ejecutivo del envío completo. */
export async function consultarAnalistaResumen({ colaborador, fecha, resultados, modelo, contexto = [] }) {
  return consultarOpenAIResumen({ colaborador, fecha, resultados, modelo: modelo ?? modeloAnalista(), contexto });
}
