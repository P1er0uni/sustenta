import { config } from "./config.mjs";
import { incrustar, maasConfigurado, mensajeNoConfigurado } from "./maas.mjs";

/**
 * Núcleo del RAG (spec 002): base de conocimiento de informes IA.
 *
 * El índice vive en Supabase Storage — mismo bucket y misma carpeta que los
 * informes ("sustentos" → informes-ia/): un archivo rag-<informe>.<proveedor>.rag
 * por informe con los fragmentos y sus embeddings. Así hereda las políticas RLS
 * que ya funcionan para los informes y NO requiere crear tablas ni ejecutar
 * SQL. (El script pgvector de la spec queda como migración futura si algún
 * día hace falta escalar a cientos de informes.)
 *
 * La etiqueta de proveedor en el nombre (maas/gemini — ver maas.mjs) permite
 * probar con Gemini y luego cambiar al MaaS de Huawei: el bucket es
 * append-only (no se puede sobrescribir), así que cada proveedor escribe sus
 * propios archivos y la búsqueda/listado usan solo los del proveedor activo.
 *
 * Indexado: HTML → texto → fragmentos → embeddings (MaaS de Huawei) →
 * archivo .rag en Storage. Recuperación: consulta → embedding → se bajan los
 * .rag → similitud coseno en JS → fragmentos más parecidos.
 *
 * Todo actúa con el access_token de Supabase que pasa quien llama (la server
 * fn de la plataforma): hereda los permisos RLS del usuario logueado, sin
 * claves nuevas. Sin MaaS configurado, cada función se degrada (devuelve
 * vacío / { ok:false }) y el flujo principal sigue igual.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://gjgezgdnpecyffjpxdep.supabase.co";
const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZ2V6Z2RucGVjeWZmanB4ZGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxNTcyNDgsImV4cCI6MjA2ODczMzI0OH0.OsAQ8hbjU0x-Ya3JZXwWz117KD961NHksrwnB8FtVTw";
const BUCKET = "sustentos";
const PREFIJO = "informes-ia";

function headersStorage(token) {
  return { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON };
}

/** Nombre del archivo de índice de un informe, etiquetado con el proveedor de
 *  embeddings: informe-x.html → rag-informe-x.maas.rag (o .gemini.rag). */
export function nombreRag(fuente) {
  const base = String(fuente ?? "informe")
    .replace(/\.html$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  return `rag-${base}.${config.maas.proveedor}.rag`;
}

/** Inverso de nombreRag: rag-informe-x.gemini.rag → informe-x.html */
export function fuenteDeNombre(nombre) {
  return `${String(nombre ?? "").replace(/^rag-/, "").replace(/\.[^.]+\.rag$/, "")}.html`;
}

/** HTML del informe → texto plano indexable (sin tags, estilos ni entidades). */
export function htmlATexto(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(tr|p|h[1-6]|table|div|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Trocea un texto en fragmentos de ~`max` caracteres con `solape` de solape,
 *  cortando en espacios para no partir palabras. */
export function fragmentar(texto, { max = 1000, solape = 150 } = {}) {
  const trozos = [];
  const t = String(texto ?? "");
  if (!t) return trozos;
  let inicio = 0;
  while (inicio < t.length) {
    let fin = Math.min(inicio + max, t.length);
    if (fin < t.length) {
      const corte = t.lastIndexOf(" ", fin);
      if (corte > inicio + Math.floor(max / 2)) fin = corte;
    }
    trozos.push(t.slice(inicio, fin).trim());
    if (fin >= t.length) break;
    inicio = Math.max(fin - solape, inicio + 1);
  }
  return trozos.filter(Boolean);
}

/** Similitud coseno entre dos vectores (0 si alguno no es válido). */
export function similitudCoseno(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let punto = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    punto += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return punto / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Sube bytes del índice a Storage. El bucket tiene una lista blanca de MIME
 *  types que no incluye application/json, así que todo viaja como
 *  application/pdf (igual que los informes): aquí Storage es solo un almacén
 *  de bytes y el contenido se parsea al leerlo. */
async function subirIndice(token, ruta, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PREFIJO}/${ruta}`, {
    method: "POST",
    headers: { ...headersStorage(token), "content-type": "application/pdf", "x-upsert": "true" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 300);
    throw new Error(`Storage rechazó la subida del índice "${ruta}" (HTTP ${res.status}): ${detalle}`);
  }
}

/** Baja bytes del índice; null si el objeto no existe. */
async function bajarIndice(token, ruta) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PREFIJO}/${ruta}`, {
    headers: headersStorage(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const texto = await res.text();
    if (res.status === 400 && /not found/i.test(texto)) return null;
    throw new Error(`Storage rechazó la lectura del índice "${ruta}" (HTTP ${res.status}): ${texto.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Nombres de los archivos de índice (rag-*.rag) en informes-ia/. Lanza con
 *  mensaje claro si Storage rechaza el listado. */
async function listarIndice(token) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...headersStorage(token), "content-type": "application/json" },
    body: JSON.stringify({
      prefix: `${PREFIJO}/`,
      limit: 1000,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    }),
  });
  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 300);
    throw new Error(`Storage rechazó el listado del índice RAG (HTTP ${res.status}): ${detalle}`);
  }
  const datos = await res.json();
  return (Array.isArray(datos) ? datos : [])
    .map((o) => String(o.name ?? "").replace(new RegExp(`^${PREFIJO}/`), ""))
    .filter((n) => n.startsWith("rag-") && n.endsWith(`.${config.maas.proveedor}.rag`));
}

/**
 * Indexa el HTML de un informe en la base de conocimiento: sube un archivo
 * rag-<informe>.rag con los fragmentos y sus embeddings. Mejor esfuerzo:
 * NUNCA lanza — devuelve { ok, motivo } y quien llama decide si lo loguea.
 */
export async function indexarInforme({ html, colaborador, fecha, fuente, token }) {
  try {
    if (!token) return { ok: false, motivo: "sin token de sesión de Supabase" };
    if (!maasConfigurado()) return { ok: false, motivo: mensajeNoConfigurado() };
    const texto = htmlATexto(html);
    if (!texto) return { ok: false, motivo: "el informe no tiene texto indexable" };
    const trozos = fragmentar(texto);
    if (!trozos.length) return { ok: false, motivo: "sin fragmentos" };
    const vectores = await incrustar(trozos, { tarea: "documento" });
    const documento = {
      version: 1,
      fuente: fuente ?? "informe",
      tipo: "informe",
      colaborador: colaborador ?? null,
      fecha: fecha || null,
      creado_at: new Date().toISOString(),
      chunks: trozos.map((fragmento, i) => ({ texto: fragmento, embedding: vectores[i] })),
    };
    await subirIndice(token, nombreRag(fuente), Buffer.from(JSON.stringify(documento), "utf8"));
    return { ok: true, fragmentos: trozos.length };
  } catch (e) {
    return { ok: false, motivo: e?.message ?? String(e) };
  }
}

/**
 * Busca los fragmentos más parecidos por significado a una consulta: baja el
 * índice de Storage y puntúa cada fragmento con similitud coseno en JS (con
 * decenas de informes es imperceptible; pgvector sería la migración a escala).
 * Lanza con mensaje claro si falta el MaaS o el token, o si Storage falla.
 */
export async function buscar({ consulta, token, k = 8 }) {
  if (!token) throw new Error("Falta la sesión de Supabase (token).");
  if (!maasConfigurado()) {
    throw new Error(mensajeNoConfigurado());
  }
  const archivos = await listarIndice(token);
  if (!archivos.length) return [];
  const [vector] = await incrustar([consulta], { tarea: "consulta" });
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("El proveedor de embeddings no devolvió un embedding válido.");
  const documentos = await Promise.all(
    archivos.map(async (nombre) => {
      const bytes = await bajarIndice(token, nombre).catch(() => null);
      if (!bytes) return null;
      try {
        const doc = JSON.parse(bytes.toString("utf8"));
        return doc && Array.isArray(doc.chunks) ? { nombre, doc } : null;
      } catch {
        return null; // índice corrupto: ignorar
      }
    }),
  );
  const hallados = [];
  for (const item of documentos) {
    if (!item) continue;
    for (const chunk of item.doc.chunks) {
      if (!chunk || !chunk.texto) continue;
      hallados.push({
        fuente: item.doc.fuente ?? fuenteDeNombre(item.nombre),
        tipo: item.doc.tipo ?? "informe",
        colaborador: item.doc.colaborador ?? null,
        fecha: item.doc.fecha ?? null,
        texto: String(chunk.texto),
        similitud: similitudCoseno(vector, chunk.embedding),
      });
    }
  }
  return hallados.sort((a, b) => b.similitud - a.similitud).slice(0, k);
}

/**
 * Contexto de referencia para el análisis de un envío: fragmentos de informes
 * anteriores relevantes al colaborador y sus actividades. Nunca lanza: sin
 * configuración o con error devuelve [] y deja constancia en el log.
 */
export async function recuperarContextoEnvio({ colaborador, fecha, registros = [], token, k = 4 }) {
  try {
    if (!token || !maasConfigurado()) return [];
    const actividades = registros
      .map((r) => [r.actividad, r.descripcion, r.proyecto?.codigo, r.proyecto?.nombre].filter(Boolean).join(" "))
      .filter(Boolean)
      .join("; ");
    const consulta = `Informes de horas de ${colaborador ?? ""}${fecha ? ` — ${fecha}` : ""}. ${actividades}`.trim();
    if (!consulta) return [];
    return await buscar({ consulta, token, k });
  } catch (e) {
    console.log(`[rag] contexto del envío omitido: ${e?.message ?? e}`);
    return [];
  }
}

/** Estado del índice: cuántos informes hay indexados (0 si no hay token).
 *  Lanza si Storage rechaza el listado. */
export async function estadoIndice(token) {
  if (!token) return { informes: 0 };
  const archivos = await listarIndice(token);
  return { informes: archivos.length };
}

/** Fuentes ya indexadas (para que el backfill sea idempotente). Lanza sin token. */
export async function fuentesExistentes(token) {
  if (!token) throw new Error("Falta la sesión de Supabase (token).");
  const archivos = await listarIndice(token);
  return archivos.map(fuenteDeNombre);
}
