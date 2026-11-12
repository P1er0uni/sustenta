import OpenAI from "openai";
import { config, VERSION_PROMPT } from "./config.mjs";
import {
  INSTRUCCION_SISTEMA,
  INSTRUCCION_SISTEMA_RESUMEN,
  ESQUEMA,
  ESQUEMA_RESUMEN,
  esquemaParaPrompt,
  descripcionRegistro,
  descripcionEnvio,
} from "./prompt.mjs";

/**
 * Capa de análisis IA con el MaaS de Huawei (ModelArts Studio) — el proveedor
 * de PRODUCCIÓN. Misma interfaz que gemini.mjs: consultarMaas (veredicto por
 * registro) y consultarMaasResumen (resumen ejecutivo del envío), sobre la API
 * de chat compatible con OpenAI del MaaS:
 *
 *   - Credenciales: MAAS_API_KEY + MAAS_BASE_URL (el access point del
 *     despliegue MaaS, propio de cada uno) + MAAS_ANALISIS_MODEL (el nombre
 *     del modelo de chat desplegado).
 *   - Archivos de evidencia: la API de chat no acepta binarios en línea como
 *     Gemini, así que cada archivo entra como texto: los xlsx/docx/pptx ya
 *     traen texto extraído (extraer.mjs), los PDF se les extrae el texto aquí
 *     (unpdf) y las imágenes van como image_url en base64 — el formato
 *     estándar de visión de la API de OpenAI, que los modelos multimodales
 *     del MaaS (p. ej. los Qwen-VL) entienden.
 *   - Salida JSON: se pide con response_format json_object y el esquema va
 *     pegado al prompt (esquemaParaPrompt). Si el despliegue rechaza algún
 *     parámetro o las imágenes, se reintenta en modo degradado (ver
 *     LLAMADAS_DEGRADADAS) — nunca falla por una capacidad que el modelo
 *     desplegado no tenga.
 *
 * El SDK de OpenAI reintenta solo los errores transitorios (429/5xx) con
 * backoff; aquí solo se clasifica lo que sí merece degradar.
 */

/** Modos de llamada, del más capaz al más conservador. Si el despliegue
 *  rechaza response_format o las imágenes (error 4xx de parámetro), se cae
 *  al siguiente modo: el análisis sigue saliendo, con lo que el modelo sí
 *  soporte. El último modo es texto plano sin formato forzado — el prompt
 *  igual exige JSON y parsearJsonSalida es tolerante. */
const LLAMADAS_DEGRADADAS = [
  { conFormatoJson: true, conMultimodal: true },
  { conFormatoJson: true, conMultimodal: false },
  { conFormatoJson: false, conMultimodal: false },
];

/** Modos para llamadas sin archivos (resumen): no hay partes multimodales,
 *  solo alterna el formato JSON forzado. */
const MODOS_SIN_ARCHIVOS = [
  { conFormatoJson: true },
  { conFormatoJson: false },
];

/** ¿El error es de parámetros/capacidad del despliegue (merece degradar la
 *  llamada)? Los 401/403 son credenciales y el 429 es límite de cuota: con
 *  esos no se degrada, se lanza tal cual. */
function esErrorDeCapacidad(e) {
  return [400, 404, 422].includes(e?.status);
}

/** Texto de un PDF (unpdf — pdf.js sin dependencias nativas). null si no hay
 *  texto (escaneado) o si la extracción falla: quien llama pone la nota. */
export async function textoDePdf(buffer) {
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text ?? "").trim() || null;
  } catch {
    return null;
  }
}

/** Extrae el texto de todos los PDF del envío UNA sola vez (lo usan todos los
 *  modos de llamada). Map nombre → texto | null. */
async function textosDePdf(archivos) {
  const textos = new Map();
  for (const a of archivos) {
    if (a.modo === "nativo" && a.ext === ".pdf" && a.buffer) {
      textos.set(a.nombre, await textoDePdf(a.buffer));
    }
  }
  return textos;
}

/**
 * Mensajes para la API de chat (formato OpenAI). Puro y síncrono para poder
 * probarlo: `textosPdf` viene preparado por quien llama (textosDePdf).
 * `conMultimodal` false convierte las imágenes en notas de texto (modo
 * degradado para modelos sin visión).
 */
export function construirMensajes(registro, archivos, { conMultimodal = true, textosPdf = new Map() } = {}) {
  const partes = [{ type: "text", text: descripcionRegistro(registro) }];
  for (const a of archivos) {
    partes.push({ type: "text", text: `\n--- DOCUMENTO: ${a.nombre} (SHA-256 ${a.hash.slice(0, 16)}…) ---` });
    if (a.modo === "texto") {
      partes.push({ type: "text", text: a.texto });
    } else if (a.ext === ".pdf") {
      const texto = textosPdf.get(a.nombre);
      partes.push(
        texto
          ? { type: "text", text: `(texto extraído del PDF)\n${texto}` }
          : { type: "text", text: "(PDF sin texto extraíble — probablemente escaneado; si no puedes leerlo, el veredicto es ilegible)" },
      );
    } else {
      // Imagen: data URL base64 (formato de visión de la API de OpenAI) o nota.
      partes.push(
        conMultimodal && a.buffer
          ? { type: "image_url", image_url: { url: `data:${a.mime};base64,${a.buffer.toString("base64")}` } }
          : { type: "text", text: "(imagen adjunta; este despliegue del modelo no admite imágenes — evalúa con la información disponible o marca ilegible si no hay otra evidencia)" },
      );
    }
  }
  partes.push({ type: "text", text: "\nEmite el veredicto." });
  return {
    sistema: `${INSTRUCCION_SISTEMA}\n\n${esquemaParaPrompt(ESQUEMA)}`,
    usuario: partes,
  };
}

/** Parsea la salida del modelo como JSON, tolerante con cercas ```json y con
 *  texto antes/después del objeto. Lanza con un recorte si no hay JSON. */
export function parsearJsonSalida(texto, proveedor = "El modelo") {
  const t = String(texto ?? "").trim();
  const sinCerca = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(sinCerca);
  } catch {
    // Texto alrededor del objeto (p. ej. "Claro, aquí tienes: {…}").
    const ini = sinCerca.indexOf("{");
    const fin = sinCerca.lastIndexOf("}");
    if (ini >= 0 && fin > ini) {
      try {
        return JSON.parse(sinCerca.slice(ini, fin + 1));
      } catch {
        /* cae al error de abajo */
      }
    }
  }
  throw new Error(`${proveedor} devolvió una respuesta que no es JSON válido: ${t.slice(0, 200)}`);
}

/** Llama al chat del MaaS recorriendo los modos: ante un error de capacidad
 *  (parámetro o imagen no soportados por el despliegue) degrada y reintenta;
 *  cualquier otro error (credenciales, cuota, red) lanza tal cual.
 *  `construirUsuario(conMultimodal)` arma el contenido del mensaje POR MODO:
 *  el modo sin multimodal convierte las imágenes en notas de texto. */
async function chatConDegradacion(cliente, { modelo, sistema, construirUsuario, modos = LLAMADAS_DEGRADADAS }) {
  let ultimoError = null;
  for (const modo of modos) {
    try {
      const params = {
        model: modelo,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: construirUsuario(modo.conMultimodal ?? true) },
        ],
      };
      if (modo.conFormatoJson) params.response_format = { type: "json_object" };
      return await cliente.chat.completions.create(params);
    } catch (e) {
      ultimoError = e;
      if (!esErrorDeCapacidad(e)) throw e;
      // Error 4xx de parámetro/capacidad: probar el modo siguiente.
    }
  }
  throw ultimoError;
}

function textoDe(respuesta) {
  const texto = respuesta?.choices?.[0]?.message?.content ?? "";
  if (!String(texto).trim()) throw new Error("El MaaS no devolvió texto en la respuesta.");
  return String(texto);
}

/** Trazabilidad: usage de la API de OpenAI ya tiene la forma registrada. */
function tokensDe(respuesta) {
  const u = respuesta?.usage;
  if (!u) return null;
  return {
    prompt_tokens: u.prompt_tokens ?? null,
    completion_tokens: u.completion_tokens ?? null,
    total_tokens: u.total_tokens ?? null,
  };
}

function clienteMaas() {
  if (!config.maas.apiKey || !config.maas.baseUrl) {
    throw new Error(
      "Falta configurar el MaaS de Huawei: define MAAS_API_KEY y MAAS_BASE_URL (el access point del despliegue MaaS) en agente-sustentos/.env.",
    );
  }
  return new OpenAI({ apiKey: config.maas.apiKey, baseURL: config.maas.baseUrl });
}

function exigirModelo(modelo) {
  if (!modelo) {
    throw new Error(
      "Falta MAAS_ANALISIS_MODEL: el nombre del modelo de chat desplegado en tu MaaS (agente-sustentos/.env).",
    );
  }
  return modelo;
}

/** Llama al MaaS y devuelve el veredicto parseado junto con la trazabilidad. */
export async function consultarMaas({ registro, archivos, modelo = config.maas.modeloAnalisis }) {
  const m = exigirModelo(modelo);
  const cliente = clienteMaas();
  // El texto de los PDF se extrae UNA vez; los mensajes se reconstruyen por
  // modo (la degradación convierte las imágenes en notas de texto).
  const textosPdf = await textosDePdf(archivos);
  const respuesta = await chatConDegradacion(cliente, {
    modelo: m,
    sistema: `${INSTRUCCION_SISTEMA}\n\n${esquemaParaPrompt(ESQUEMA)}`,
    construirUsuario: (conMultimodal) =>
      construirMensajes(registro, archivos, { conMultimodal, textosPdf }).usuario,
  });
  const veredicto = parsearJsonSalida(textoDe(respuesta), "El MaaS");
  return {
    veredicto,
    traza: { modelo: m, versionPrompt: VERSION_PROMPT, tokens: tokensDe(respuesta) },
  };
}

/**
 * Resumen ejecutivo del envío completo: un párrafo para la jefatura y una
 * acción recomendada. Una sola llamada, sin adjuntar documentos.
 * `contexto` (opcional): fragmentos RAG de informes anteriores — referencia.
 */
export async function consultarMaasResumen({ colaborador, fecha, resultados, modelo = config.maas.modeloAnalisis, contexto = [] }) {
  const m = exigirModelo(modelo);
  const cliente = clienteMaas();
  const respuesta = await chatConDegradacion(cliente, {
    modelo: m,
    // Sin archivos no hay partes multimodales: solo alterna el formato JSON.
    modos: MODOS_SIN_ARCHIVOS,
    sistema: `${INSTRUCCION_SISTEMA_RESUMEN}\n\n${esquemaParaPrompt(ESQUEMA_RESUMEN)}`,
    construirUsuario: () => [{ type: "text", text: descripcionEnvio(colaborador, fecha, resultados, contexto) }],
  });
  const resumen = parsearJsonSalida(textoDe(respuesta), "El MaaS");
  return {
    ...resumen,
    traza: { modelo: m, versionPrompt: VERSION_PROMPT, tokens: tokensDe(respuesta) },
  };
}
