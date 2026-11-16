import OpenAI from "openai";
import { config, VERSION_PROMPT } from "./config.mjs";
import {
  INSTRUCCION_SISTEMA,
  INSTRUCCION_SISTEMA_RESUMEN,
  ESQUEMA,
  ESQUEMA_RESUMEN,
  descripcionRegistro,
  descripcionEnvio,
} from "./prompt.mjs";

/**
 * Capa de análisis IA con OpenAI (el proveedor de los informes: veredictos por
 * registro y resumen ejecutivo del envío), sobre la API Responses con
 * structured outputs — como funcionaba antes de la migración al MaaS:
 *
 *   - PDFs e imágenes van como archivos/imágenes en línea (input_file /
 *     input_image): GPT los lee nativamente.
 *   - La salida se fuerza al esquema con text.format json_schema strict.
 *   - Autenticación con la OPENAI_API_KEY.
 *
 * Las instrucciones y el esquema viven en prompt.mjs. Sin cadena de
 * redundancia: si el modelo falla, conReintentos reintenta lo transitorio y
 * el error final explica qué pasó.
 */

/** Contenido del mensaje para la API Responses: texto + archivos nativos en
 *  línea. Exportada para probarla (test/analista.test.mjs). */
export function construirContenido(registro, archivos) {
  const contenido = [{ type: "input_text", text: descripcionRegistro(registro) }];
  for (const a of archivos) {
    contenido.push({ type: "input_text", text: `\n--- DOCUMENTO: ${a.nombre} (SHA-256 ${a.hash.slice(0, 16)}…) ---` });
    if (a.modo === "nativo") {
      const dataUrl = `data:${a.mime};base64,${a.buffer.toString("base64")}`;
      // PDFs van como archivo; imágenes (PNG/JPG) como imagen, ambos en línea.
      contenido.push(
        a.mime === "application/pdf"
          ? { type: "input_file", filename: a.nombre, file_data: dataUrl }
          : { type: "input_image", image_url: dataUrl },
      );
    } else {
      contenido.push({ type: "input_text", text: a.texto });
    }
  }
  contenido.push({ type: "input_text", text: "\nEmite el veredicto." });
  return contenido;
}

async function conReintentos(fn, intentos = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // Sin crédito o cuota agotada: reintentar no lo soluciona. Se avisa en claro.
      if (e?.status === 429 && /quota|billing|exceeded your current quota/i.test(e?.message ?? "")) {
        throw new Error(
          "Cuota de OpenAI agotada o sin crédito en la cuenta. Revisa tu saldo y método de pago en " +
            "platform.openai.com (Billing), o prueba otro modelo con --modelo <id>.",
        );
      }
      const transitorio =
        [429, 500, 503, 504].includes(e?.status) || /overloaded|unavailable|fetch failed|timeout/i.test(e?.message ?? "");
      if (!transitorio || i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    }
  }
}

/** Llama a OpenAI y devuelve el veredicto parseado junto con la trazabilidad de la llamada. */
export async function consultarOpenAI({ registro, archivos, modelo = config.openai.modelo }) {
  if (!config.openai.apiKey) throw new Error("Falta OPENAI_API_KEY (agente-sustentos/.env o variables de entorno).");
  const cliente = new OpenAI({ apiKey: config.openai.apiKey });
  const respuesta = await conReintentos(() =>
    cliente.responses.create({
      model: modelo,
      instructions: INSTRUCCION_SISTEMA,
      input: [{ role: "user", content: construirContenido(registro, archivos) }],
      // Salida obligatoriamente conforme al esquema (structured outputs).
      text: { format: { type: "json_schema", name: "veredicto_sustento", strict: true, schema: ESQUEMA } },
    }),
  );
  let veredicto;
  try {
    veredicto = JSON.parse(respuesta.output_text);
  } catch {
    throw new Error(`OpenAI devolvió una respuesta que no es JSON válido: ${String(respuesta.output_text).slice(0, 200)}`);
  }
  return {
    veredicto,
    traza: { modelo, versionPrompt: VERSION_PROMPT, tokens: respuesta.usage ?? null },
  };
}

/**
 * Resumen ejecutivo del envío completo: un párrafo para la jefatura y una acción recomendada.
 * Una sola llamada, sin adjuntar documentos (solo los veredictos ya emitidos).
 * `contexto` (opcional): fragmentos RAG de informes anteriores — material de referencia.
 */
export async function consultarOpenAIResumen({ colaborador, fecha, resultados, modelo = config.openai.modelo, contexto = [] }) {
  if (!config.openai.apiKey) throw new Error("Falta OPENAI_API_KEY (agente-sustentos/.env o variables de entorno).");
  const cliente = new OpenAI({ apiKey: config.openai.apiKey });
  const respuesta = await conReintentos(() =>
    cliente.responses.create({
      model: modelo,
      instructions: INSTRUCCION_SISTEMA_RESUMEN,
      input: [
        { role: "user", content: [{ type: "input_text", text: descripcionEnvio(colaborador, fecha, resultados, contexto) }] },
      ],
      text: { format: { type: "json_schema", name: "resumen_envio", strict: true, schema: ESQUEMA_RESUMEN } },
    }),
  );
  let resumen;
  try {
    resumen = JSON.parse(respuesta.output_text);
  } catch {
    throw new Error(`OpenAI devolvió una respuesta que no es JSON válido: ${String(respuesta.output_text).slice(0, 200)}`);
  }
  return {
    ...resumen,
    traza: { modelo, versionPrompt: VERSION_PROMPT, tokens: respuesta.usage ?? null },
  };
}
