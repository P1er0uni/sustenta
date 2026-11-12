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
 * Capa de análisis IA con Gemini (Google AI Studio). Migra del anterior
 * openai.mjs (2026-11-11): misma interfaz — consultarGemini (veredicto por
 * registro, con los archivos adjuntos en línea) y consultarGeminiResumen
 * (resumen ejecutivo del envío) — sobre la API nativa generateContent:
 *   - PDFs e imágenes van como inline_data (Gemini los lee nativamente).
 *   - La salida se fuerza al esquema con response_schema (JSON estructurado).
 *   - Autenticación con la GEMINI_API_KEY (header x-goog-api-key).
 *
 * Las instrucciones y el esquema viven en prompt.mjs, compartidos con el
 * MaaS de Huawei (maas-llm.mjs): el dispatcher analista.mjs elige proveedor.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Partes del mensaje para generateContent: texto + archivos nativos en línea. */
function construirPartes(registro, archivos) {
  const partes = [{ text: descripcionRegistro(registro) }];
  for (const a of archivos) {
    partes.push({ text: `\n--- DOCUMENTO: ${a.nombre} (SHA-256 ${a.hash.slice(0, 16)}…) ---` });
    if (a.modo === "nativo") {
      // PDFs e imágenes van como inline_data: Gemini los lee nativamente.
      partes.push({ inline_data: { mime_type: a.mime, data: a.buffer.toString("base64") } });
    } else {
      partes.push({ text: a.texto });
    }
  }
  partes.push({ text: "\nEmite el veredicto." });
  return partes;
}

/**
 * POST a la API de Gemini con la GEMINI_API_KEY. `metodo` es la ruta del
 * endpoint sin la base (p. ej. "models/gemini-3.1-flash-lite:generateContent").
 * Exportada: maas.mjs la reusa para los embeddings del RAG.
 */
export async function postGemini(metodo, cuerpo) {
  const res = await fetch(`${API}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
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

async function conReintentos(fn, intentos = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // 429 de Gemini (RESOURCE_EXHAUSTED): en la capa gratuita suele ser el
      // límite por minuto — reintentar con espera resuelve; si es el límite
      // diario, se agotan los intentos y el mensaje de Google explica la causa.
      const transitorio =
        [429, 500, 503, 504].includes(e?.status) ||
        /overloaded|unavailable|fetch failed|timeout|RESOURCE_EXHAUSTED/i.test(e?.message ?? "");
      if (!transitorio || i >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    }
  }
}

/** Texto de la respuesta de generateContent (une las partes del candidato). */
function textoDe(respuesta) {
  const partes = respuesta?.candidates?.[0]?.content?.parts ?? [];
  const texto = partes.map((p) => p?.text ?? "").join("").trim();
  if (!texto) {
    const motivo =
      respuesta?.candidates?.[0]?.finishReason ??
      respuesta?.promptFeedback?.blockReason ??
      "respuesta sin contenido";
    throw new Error(`Gemini no devolvió texto (${motivo}).`);
  }
  return texto;
}

/** Trazabilidad: usageMetadata de Gemini con la misma forma que registraba OpenAI. */
function tokensDe(respuesta) {
  const u = respuesta?.usageMetadata;
  if (!u) return null;
  return {
    prompt_tokens: u.promptTokenCount ?? null,
    completion_tokens: u.candidatesTokenCount ?? null,
    total_tokens: u.totalTokenCount ?? null,
  };
}

/** Llama a Gemini y devuelve el veredicto parseado junto con la trazabilidad de la llamada. */
export async function consultarGemini({ registro, archivos, modelo = config.modelo }) {
  if (!config.apiKey) throw new Error("Falta GEMINI_API_KEY (agente-sustentos/.env; créala en aistudio.google.com).");
  const respuesta = await conReintentos(() =>
    postGemini(`models/${modelo}:generateContent`, {
      system_instruction: { parts: [{ text: INSTRUCCION_SISTEMA }] },
      contents: [{ role: "user", parts: construirPartes(registro, archivos) }],
      // Salida obligatoriamente conforme al esquema (JSON estructurado).
      generation_config: { response_mime_type: "application/json", response_schema: ESQUEMA },
    }),
  );
  const texto = textoDe(respuesta);
  let veredicto;
  try {
    veredicto = JSON.parse(texto);
  } catch {
    throw new Error(`Gemini devolvió una respuesta que no es JSON válido: ${texto.slice(0, 200)}`);
  }
  return {
    veredicto,
    traza: { modelo, versionPrompt: VERSION_PROMPT, tokens: tokensDe(respuesta) },
  };
}

/**
 * Resumen ejecutivo del envío completo: un párrafo para la jefatura y una acción recomendada.
 * Una sola llamada, sin adjuntar documentos (solo los veredictos ya emitidos).
 * `contexto` (opcional): fragmentos RAG de informes anteriores — material de referencia.
 */
export async function consultarGeminiResumen({ colaborador, fecha, resultados, modelo = config.modelo, contexto = [] }) {
  if (!config.apiKey) throw new Error("Falta GEMINI_API_KEY (agente-sustentos/.env; créala en aistudio.google.com).");
  const respuesta = await conReintentos(() =>
    postGemini(`models/${modelo}:generateContent`, {
      system_instruction: { parts: [{ text: INSTRUCCION_SISTEMA_RESUMEN }] },
      contents: [{ role: "user", parts: [{ text: descripcionEnvio(colaborador, fecha, resultados, contexto) }] }],
      generation_config: { response_mime_type: "application/json", response_schema: ESQUEMA_RESUMEN },
    }),
  );
  const texto = textoDe(respuesta);
  let resumen;
  try {
    resumen = JSON.parse(texto);
  } catch {
    throw new Error(`Gemini devolvió una respuesta que no es JSON válido: ${texto.slice(0, 200)}`);
  }
  return {
    ...resumen,
    traza: { modelo, versionPrompt: VERSION_PROMPT, tokens: tokensDe(respuesta) },
  };
}
