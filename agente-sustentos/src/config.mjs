import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Lee agente-sustentos/.env sin depender de otra librería. process.env tiene prioridad. */
function leerEnv() {
  const ruta = fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(ruta)) return {};
  return Object.fromEntries(
    readFileSync(ruta, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = { ...leerEnv(), ...process.env };

/** Quita BOM (U+FEFF) y espacios de un valor de entorno: las env vars
 *  pegadas desde archivos/editores pueden arrastrar un BOM invisible que
 *  rompe el header Authorization (ByteString > 255). */
const limpiar = (v) => String(v ?? "").replace(/^﻿+/, "").trim();

// Proveedor de los EMBEDDINGS del RAG (spec 002): "maas" (producción — si el
// despliegue MaaS los expone) o "gemini" (pruebas). Cualquier otro valor cae
// a "maas". NOTA: el MaaS de Huawei (CN-Hong Kong) hoy es SOLO de chat — no
// expone embeddings — así que el RAG corre con "gemini".
const proveedorPedidor = limpiar(env.MAAS_PROVEEDOR).toLowerCase();
const proveedor = ["maas", "gemini"].includes(proveedorPedidor) ? proveedorPedidor : "maas";

// Proveedor del ANÁLISIS (quién genera los informes): "maas" (MaaS de Huawei
// — producción) o "gemini" (pruebas). Separado del de embeddings: cada cosa
// va con el proveedor que la soporte.
const proveedorIAPedidor = limpiar(env.IA_PROVEEDOR).toLowerCase();
const proveedorIA = ["maas", "gemini"].includes(proveedorIAPedidor) ? proveedorIAPedidor : "maas";

export const config = {
  // Proveedor del análisis (informes) — lo usa analista.mjs.
  proveedorIA,
  apiKey: limpiar(env.GEMINI_API_KEY),
  // Modelo por defecto de Gemini (análisis de sustentos); se puede
  // sobreescribir con GEMINI_MODEL o --modelo. gemini-3.1-flash-lite: el más
  // barato de los actuales, con capa gratuita (aistudio.google.com/docs/pricing).
  modelo: limpiar(env.GEMINI_MODEL) || "gemini-3.1-flash-lite",
  modeloProfundo: limpiar(env.GEMINI_MODEL_PRO) || "gemini-3.1-flash-lite",
  // MaaS de Huawei (ModelArts Studio). Credenciales compartidas por los dos
  // usos: el ANÁLISIS de los informes (maas-llm.mjs, con IA_PROVEEDOR=maas)
  // y — si el despliegue los expone — los EMBEDDINGS del RAG (maas.mjs, con
  // MAAS_PROVEEDOR=maas). El access point (baseUrl) es propio de cada
  // despliegue MaaS. Sin credenciales del proveedor activo, todo se degrada
  // elegantemente (se omite y se loguea).
  maas: {
    proveedor,
    apiKey: limpiar(env.MAAS_API_KEY),
    baseUrl: limpiar(env.MAAS_BASE_URL),
    // Modelo de chat que genera los informes (análisis de sustentos). El
    // nombre es el del modelo desplegado en TU MaaS — no hay default porque
    // cada despliegue expone los suyos.
    modeloAnalisis: limpiar(env.MAAS_ANALISIS_MODEL),
    // Embeddings del RAG (spec 002). Con gemini: gemini-embedding-001 a 1024
    // dims — las mismas que bge-m3, para que el paso a producción no cambie
    // la dimensionalidad del índice.
    modelo: limpiar(env.MAAS_EMBEDDING_MODEL) || (proveedor === "gemini" ? "gemini-embedding-001" : "bge-m3"),
    dims: Number(limpiar(env.MAAS_EMBEDDING_DIMS)) || 1024,
  },
};

/** Versión del prompt: se guarda con cada análisis para poder auditarlo. */
export const VERSION_PROMPT = "2026-11-11.3";
