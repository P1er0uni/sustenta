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

export const config = {
  apiKey: limpiar(env.OPENAI_API_KEY),
  // Modelo por defecto de OpenAI; se puede sobreescribir con OPENAI_MODEL o --modelo.
  modelo: limpiar(env.OPENAI_MODEL) || "gpt-5.6",
  modeloProfundo: limpiar(env.OPENAI_MODEL_PRO) || "gpt-5.6",
};

/** Versión del prompt: se guarda con cada análisis para poder auditarlo. */
export const VERSION_PROMPT = "2026-11-03.2-resumen-evidencia";
