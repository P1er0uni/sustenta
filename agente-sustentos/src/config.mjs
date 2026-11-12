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

// Proveedor de embeddings del RAG: "maas" (producción) o "gemini" (pruebas).
// Cualquier otro valor (p. ej. un "openai" de un .env antiguo) cae a "maas".
const proveedorPedidor = limpiar(env.MAAS_PROVEEDOR).toLowerCase();
const proveedorEmbeddings = ["maas", "gemini"].includes(proveedorPedidor) ? proveedorPedidor : "maas";

export const config = {
  apiKey: limpiar(env.GEMINI_API_KEY),
  // Modelo por defecto de Gemini (análisis de sustentos); se puede
  // sobreescribir con GEMINI_MODEL o --modelo. gemini-3.1-flash-lite: el más
  // barato de los actuales, con capa gratuita (aistudio.google.com/docs/pricing).
  modelo: limpiar(env.GEMINI_MODEL) || "gemini-3.1-flash-lite",
  modeloProfundo: limpiar(env.GEMINI_MODEL_PRO) || "gemini-3.1-flash-lite",
  // Embeddings del RAG (spec 002). Proveedor: "maas" (MaaS de Huawei — el
  // objetivo de producción) o "gemini" (PRUEBAS con la GEMINI_API_KEY de arriba,
  // mientras llegan las credenciales del MaaS). El access point (baseURL) es
  // propio de cada despliegue MaaS. Sin credenciales del proveedor activo,
  // todo el RAG se degrada elegantemente (se omite y se loguea).
  maas: {
    proveedor: proveedorEmbeddings,
    apiKey: limpiar(env.MAAS_API_KEY),
    baseUrl: limpiar(env.MAAS_BASE_URL),
    // Con gemini: gemini-embedding-001 a 1024 dims — las mismas que bge-m3,
    // para que el paso a producción no cambie la dimensionalidad del índice.
    modelo: limpiar(env.MAAS_EMBEDDING_MODEL) || (proveedorEmbeddings === "gemini" ? "gemini-embedding-001" : "bge-m3"),
    dims: Number(limpiar(env.MAAS_EMBEDDING_DIMS)) || 1024,
  },
};

/** Versión del prompt: se guarda con cada análisis para poder auditarlo. */
export const VERSION_PROMPT = "2026-11-11.2-gemini";
