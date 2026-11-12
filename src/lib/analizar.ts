import { createServerFn } from "@tanstack/react-start";
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";

interface AnalizarInput {
  fecha: string;
  colaborador: string;
  proyectoCodigo: string;
}

interface AnalizarResultado {
  ok: boolean;
  salida: string;
  pdfArchivo?: string | undefined;
  /** Redundancia del MaaS: avisos de cambio de modelo ("glm-5.3 no disponible
   *  → usando glm-5.2") para notificar en la UI. */
  avisosModelo?: string[];
}

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Informes IA en Vercel ───────────────────────────────────────────────────
// En el serverless el filesystem es de solo lectura y no hay Chrome: los
// informes viven en Supabase Storage (bucket "sustentos", prefijo informes-ia/)
// y las server fns actúan con el token de Supabase que pasa el navegador, así
// heredan los permisos (RLS) del usuario logueado — sin claves nuevas.

const SUPABASE_URL = "https://gjgezgdnpecyffjpxdep.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZ2V6Z2RucGVjeWZmanB4ZGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxNTcyNDgsImV4cCI6MjA2ODczMzI0OH0.OsAQ8hbjU0x-Ya3JZXwWz117KD961NHksrwnB8FtVTw";

const EN_VERCEL = !!process.env.VERCEL;
const BUCKET_SUSTENTOS = "sustentos";
const PREFIJO_INFORMES = "informes-ia";

/** Entrada del manifest de informes IA (local: public/informes/manifest.json;
 *  Vercel: informes-ia/manifest.json en Storage). */
interface ManifestEntrada {
  tipo?: string;
  proyecto?: string;
  fecha?: string;
  colaborador?: string;
  periodo?: string;
  archivo?: string;
  htmlArchivo?: string;
  veredicto?: string;
  aprobado?: boolean;
  /** true cuando el informe aprobado se guardó como HTML sellado (Vercel, sin
   *  Chrome en el servidor): el PDF lo imprime el navegador del aprobador. */
  sinPdf?: boolean;
  /** Cuándo se subió esta versión a Storage (solo Vercel). */
  creado?: string;
  registros?: { registroId?: string; fecha?: string; proyecto?: string; veredicto?: string }[];
}

function headersStorage(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON };
}

/** Sube bytes a Storage. El bucket tiene una lista blanca de MIME types que no
 *  incluye text/html ni application/json, así que todo viaja como
 *  application/pdf: aquí Storage es solo un almacén de bytes — el contenido se
 *  sirve por leerInformeIA con el tipo correcto. */
async function subirStorage(token: string, ruta: string, bytes: Buffer): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET_SUSTENTOS}/${PREFIJO_INFORMES}/${ruta}`,
    {
      method: "POST",
      headers: { ...headersStorage(token), "content-type": "application/pdf", "x-upsert": "true" },
      body: new Uint8Array(bytes),
    },
  );
  if (!res.ok) {
    throw new Error(`Storage rechazó la subida de "${ruta}" (HTTP ${res.status}): ${await res.text()}`);
  }
}

/** Baja bytes de Storage; null si el objeto todavía no existe. */
async function bajarStorage(token: string, ruta: string): Promise<Buffer | null> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET_SUSTENTOS}/${PREFIJO_INFORMES}/${ruta}`,
    { headers: headersStorage(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const texto = await res.text();
    if (res.status === 400 && /not found/i.test(texto)) return null;
    throw new Error(`Storage rechazó la lectura de "${ruta}" (HTTP ${res.status}): ${texto}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

interface ObjetoStorage {
  name?: string;
  created_at?: string;
}

/** Lista los objetos del prefijo informes-ia/ (más recientes primero). */
async function listarStorage(token: string): Promise<ObjetoStorage[]> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET_SUSTENTOS}`, {
    method: "POST",
    headers: { ...headersStorage(token), "content-type": "application/json" },
    body: JSON.stringify({
      prefix: `${PREFIJO_INFORMES}/`,
      limit: 1000,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Storage rechazó el listado de informes (HTTP ${res.status}): ${await res.text()}`);
  }
  const datos = await res.json();
  return Array.isArray(datos) ? datos : [];
}

/**
 * Reconstruye el manifest desde los companions .json del prefijo. El bucket
 * NO permite UPDATE ni DELETE sobre informes-ia/ (RLS), así que cada
 * generación/aprobación escribe archivos nuevos con nombre único y el
 * manifest se dedupe por (tipo, fecha, colaborador, proyecto) quedándose con
 * la versión más reciente (el listado viene más-reciente-primero).
 */
async function manifestDesdeStorage(token: string): Promise<ManifestEntrada[]> {
  const objetos = await listarStorage(token);
  const companions = new Map<string, ManifestEntrada>();
  await Promise.all(
    objetos.map(async (obj) => {
      const nombre = (obj.name ?? "").replace(/^informes-ia\//, "");
      if (!nombre.endsWith(".json") || nombre === "manifest.json") return;
      const bytes = await bajarStorage(token, nombre).catch(() => null);
      if (!bytes) return;
      try {
        const entrada = JSON.parse(bytes.toString("utf8"));
        if (entrada && typeof entrada === "object") {
          companions.set(nombre, { ...entrada, creado: obj.created_at });
        }
      } catch {
        // companion corrupto: ignorar
      }
    }),
  );
  // El listado viene más-reciente-primero: al deduplicar gana la versión más
  // nueva de cada (tipo, fecha, colaborador, proyecto).
  const clave = (m: ManifestEntrada) =>
    `${m.tipo ?? "registro"}|${m.fecha ?? ""}|${sinTildes(m.colaborador ?? "")}|${m.proyecto ?? ""}`;
  const vistas = new Set<string>();
  const entradas: ManifestEntrada[] = [];
  for (const obj of objetos) {
    const nombre = (obj.name ?? "").replace(/^informes-ia\//, "");
    const entrada = companions.get(nombre);
    if (!entrada) continue;
    const k = clave(entrada);
    if (vistas.has(k)) continue;
    vistas.add(k);
    entradas.push(entrada);
  }
  return entradas;
}

/** Ruta local del manifest (modo dev/local: public/informes). */
const manifestLocal = () => join(resolve(process.cwd(), "public"), "informes", "manifest.json");

/**
 * Busca en agente-sustentos/casos/ el .json cuyo registro coincide con la fila
 * (fecha + proyecto.codigo + colaborador) y devuelve su nombre de archivo.
 */
async function encontrarCaso(casosDir: string, input: AnalizarInput): Promise<string | null> {
  const archivos = await readdir(casosDir).catch(() => []);
  const nombreBuscado = sinTildes(input.colaborador);

  for (const archivo of archivos) {
    if (!archivo.endsWith(".json")) continue;
    try {
      const contenido = JSON.parse(await readFile(join(casosDir, archivo), "utf8"));
      const reg = contenido?.registro;
      if (!reg) continue;
      const coincideFecha = reg.fecha === input.fecha;
      const coincideProyecto = reg.proyecto?.codigo === input.proyectoCodigo;
      const coincideColaborador = sinTildes(reg.colaborador ?? "").split(/\s+/).every((p: string) => nombreBuscado.includes(p));
      if (coincideFecha && coincideProyecto && coincideColaborador) {
        return archivo;
      }
    } catch {
      // archivo inválido, saltar
    }
  }
  return null;
}

/**
 * Lee public/informes/manifest.json y encuentra el PDF que coincide con la fila.
 */
async function encontrarPdf(publicDir: string, input: AnalizarInput): Promise<string | null> {
  const manifestPath = join(publicDir, "informes", "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest)) return null;
    const nombreBuscado = sinTildes(input.colaborador);
    const entrada = manifest.find(
      (m: { proyecto?: string; fecha?: string; colaborador?: string; archivo?: string }) =>
        m.proyecto === input.proyectoCodigo &&
        m.fecha === input.fecha &&
        sinTildes(m.colaborador ?? "").split(/\s+/).every((p: string) => nombreBuscado.includes(p)),
    );
    return entrada?.archivo ?? null;
  } catch {
    return null;
  }
}

/**
 * Lee public/informes/manifest.json y encuentra el PDF del informe consolidado
 * (tipo "lote") del colaborador y día de trabajo indicados.
 */
async function encontrarPdfLote(publicDir: string, colaborador: string, fecha: string): Promise<string | null> {
  const manifestPath = join(publicDir, "informes", "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest)) return null;
    const nombreBuscado = sinTildes(colaborador);
    const entrada = manifest.find(
      (m: { tipo?: string; colaborador?: string; fecha?: string; archivo?: string }) =>
        m.tipo === "lote" &&
        m.fecha === fecha &&
        sinTildes(m.colaborador ?? "").split(/\s+/).every((p: string) => nombreBuscado.includes(p)),
    );
    return entrada?.archivo ?? null;
  } catch {
    return null;
  }
}

/**
 * Lee public/informes/manifest.json y devuelve la entrada completa del informe
 * consolidado (tipo "lote") del colaborador y día indicados — la usa el indexado
 * RAG para encontrar el HTML publicado del envío.
 */
async function entradaLoteManifest(
  publicDir: string,
  colaborador: string,
  fecha: string,
): Promise<ManifestEntrada | null> {
  const manifestPath = join(publicDir, "informes", "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest)) return null;
    const nombreBuscado = sinTildes(colaborador);
    return (
      (manifest as ManifestEntrada[]).find(
        (m) =>
          m.tipo === "lote" &&
          m.fecha === fecha &&
          sinTildes(m.colaborador ?? "").split(/\s+/).every((p: string) => nombreBuscado.includes(p)),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Ejecuta el agente de sustentos para un único registro (el de la fila donde
 * se hizo clic). Genera el PDF, lo publica en public/informes/ con su manifest,
 * y devuelve el nombre del archivo PDF para que el frontend lo abra.
 */
export const analizarCasos = createServerFn()
  .validator((input: AnalizarInput) => input)
  .handler(async ({ data }): Promise<AnalizarResultado> => {
    const agenteDir = resolve(process.cwd(), "agente-sustentos");
    const casosDir = join(agenteDir, "casos");
    const publicDir = resolve(process.cwd(), "public");

    // 1. Encontrar el caso .json que corresponde a esta fila
    const casoArchivo = await encontrarCaso(casosDir, data);
    if (!casoArchivo) {
      return {
        ok: false,
        salida: `No se encontró un caso en casos/ que coincida con fecha=${data.fecha}, proyecto=${data.proyectoCodigo}, colaborador=${data.colaborador}.`,
      };
    }

    // 2. Ejecutar el agente solo para ese caso (node directo: sin overhead de npm)
    const resultado = await new Promise<{ ok: boolean; salida: string }>((resolverFn) => {
      const proc = spawn(process.execPath, [join("src", "cli.mjs"), `casos/${casoArchivo}`], {
        cwd: agenteDir,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      let salida = "";
      proc.stdout.on("data", (d: Buffer) => (salida += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (salida += d.toString()));

      proc.on("error", (err) => {
        resolverFn({ ok: false, salida: `No se pudo lanzar npm: ${err.message}` });
      });

      proc.on("close", (code) => {
        resolverFn({
          ok: code === 0,
          salida: salida || (code === 0 ? "Análisis completado." : `Exit code ${code}`),
        });
      });
    });

    if (!resultado.ok) {
      return { ok: false, salida: resultado.salida };
    }

    // 3. Leer el manifest para encontrar el PDF generado
    const pdfArchivo = await encontrarPdf(publicDir, data);

    return {
      ok: true,
      salida: resultado.salida,
      pdfArchivo: pdfArchivo ?? undefined,
    };
  });

interface EnvioSustentoInput {
  nombre: string;
  /** URL firmada de Storage (corta vigencia) para que el servidor baje el archivo. */
  url: string;
  hash: string | null;
}

interface EnvioRegistroInput {
  id: string;
  fecha: string;
  horas: number;
  actividad: string | null;
  descripcion: string | null;
  proyectoCodigo: string | null;
  proyectoNombre: string | null;
  empresa: string | null;
  sustentos: EnvioSustentoInput[];
}

interface AnalizarEnvioInput {
  colaborador: string;
  registros: EnvioRegistroInput[];
  /** Token de Supabase de la sesión del jefe: en Vercel lo usan las llamadas
   *  a Storage (hereda los permisos RLS del usuario). Local lo ignora. */
  token?: string;
}

/**
 * Ejecuta el agente de sustentos sobre TODOS los registros enviados de un colaborador
 * y genera un único informe consolidado del envío (flag --lote del agente).
 * El navegador (con la sesión del jefe) baja la evidencia con URLs firmadas y se la
 * pasa aquí; el servidor la escribe como casos del agente y lanza el análisis.
 */
export const analizarEnvio = createServerFn({ method: "POST" })
  .validator((input: AnalizarEnvioInput) => input)
  .handler(async ({ data }): Promise<AnalizarResultado> => {
    try {
      if (!data.colaborador || !data.registros?.length) {
        return { ok: false, salida: "El envío no tiene registros para analizar." };
      }

      // ─── Vercel: pipeline importado + Storage (no hay CLI ni public/). ───
      if (EN_VERCEL) {
        if (!data.token) return { ok: false, salida: "Falta la sesión de Supabase (token)." };
        const fechaEnvio = data.registros[0]?.fecha ?? "";
        const slug =
          sinTildes(data.colaborador).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "envio";
        const envioDir = join(tmpdir(), "sustenta-envios", slug);
        await rm(envioDir, { recursive: true, force: true }).catch(() => {});
        await mkdir(envioDir, { recursive: true });

        // 1. Bajar la evidencia de cada registro (en paralelo) a /tmp.
        const casos = await Promise.all(
          data.registros.map(async (reg) => {
            const rutas: string[] = [];
            for (const s of reg.sustentos ?? []) {
              if (!s.url) continue;
              const res = await fetch(s.url);
              if (!res.ok) {
                throw new Error(`No se pudo descargar la evidencia "${s.nombre}" (HTTP ${res.status}).`);
              }
              const nombreLimpio = basename(s.nombre).replace(/[\\/:*?"<>|]/g, "_");
              const archivoLocal = join(envioDir, `${reg.id}-${nombreLimpio}`);
              await writeFile(archivoLocal, Buffer.from(await res.arrayBuffer()));
              rutas.push(archivoLocal);
            }
            return {
              registro: {
                id: reg.id,
                fecha: reg.fecha,
                horas: reg.horas,
                colaborador: data.colaborador,
                actividad: reg.actividad,
                descripcion: reg.descripcion,
                empresaReceptora: reg.empresa,
                hashGuardado: (reg.sustentos?.length ?? 0) === 1 ? (reg.sustentos?.[0]?.hash ?? null) : null,
                proyecto: { codigo: reg.proyectoCodigo, nombre: reg.proyectoNombre },
              },
              rutas,
            };
          }),
        );

        // 2. Analizar (reglas + IA) y armar el informe consolidado del envío.
        //    Con el token del usuario, el pipeline recupera el contexto RAG
        //    (informes anteriores) para el resumen ejecutivo (spec 002).
        const { analizarEnvioLote } = await import("../../agente-sustentos/src/lote.mjs");
        const out = await analizarEnvioLote({
          colaborador: data.colaborador,
          fecha: fechaEnvio,
          casos,
          token: data.token,
        });

        // 3. Publicar en Storage: HTML + companion .json con la entrada del
        //    manifest. Nombre único por timestamp — el bucket no permite
        //    UPDATE ni DELETE, así que nunca se reescribe un archivo; el
        //    companion más reciente gana al reconstruir el manifest.
        const hhmmss = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
        const base = `${out.nombreHtml.replace(/\.html$/, "")}-${hhmmss}`;
        const entrada = { ...out.entrada, archivo: `${base}.pdf`, htmlArchivo: `${base}.html` };
        await subirStorage(data.token, entrada.htmlArchivo, Buffer.from(out.html, "utf8"));
        await subirStorage(data.token, `${base}.json`, Buffer.from(JSON.stringify(entrada), "utf8"));

        // 4. RAG (spec 002): indexar el informe generado en la base de
        //    conocimiento. Mejor esfuerzo — el informe ya está publicado; si
        //    falla (sin MaaS, sin token, error de red) solo queda en el log.
        try {
          const { indexarInforme } = await import("../../agente-sustentos/src/rag.mjs");
          const rag = await indexarInforme({
            html: out.html,
            colaborador: data.colaborador,
            fecha: fechaEnvio,
            fuente: entrada.htmlArchivo,
            token: data.token,
          });
          console.log(
            rag.ok
              ? `[analizarEnvio] RAG: ${rag.fragmentos} fragmento(s) indexados (${entrada.htmlArchivo})`
              : `[analizarEnvio] RAG omitido: ${rag.motivo}`,
          );
        } catch (e) {
          console.error("[analizarEnvio] RAG (omitido):", e);
        }
        return { ok: true, salida: out.salida, pdfArchivo: entrada.archivo, avisosModelo: out.avisos ?? [] };
      }

      const agenteDir = resolve(process.cwd(), "agente-sustentos");
      const publicDir = resolve(process.cwd(), "public");
      const slug =
        sinTildes(data.colaborador).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "envio";
      const envioDir = join(agenteDir, "casos", "envios", slug);
      await mkdir(envioDir, { recursive: true });

      // 1. Bajar la evidencia de cada registro (en paralelo) y armar los casos del agente.
      const casosArg = await Promise.all(
        data.registros.map(async (reg) => {
          const archivosNombres: string[] = [];
          for (const s of reg.sustentos ?? []) {
            if (!s.url) continue;
            const res = await fetch(s.url);
            if (!res.ok) {
              throw new Error(`No se pudo descargar la evidencia "${s.nombre}" (HTTP ${res.status}).`);
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            const nombreLimpio = basename(s.nombre).replace(/[\\/:*?"<>|]/g, "_");
            const archivoLocal = `${reg.id}-${nombreLimpio}`;
            await writeFile(join(envioDir, archivoLocal), buffer);
            archivosNombres.push(archivoLocal);
          }
          const caso = {
            registro: {
              id: reg.id,
              fecha: reg.fecha,
              horas: reg.horas,
              colaborador: data.colaborador,
              actividad: reg.actividad,
              descripcion: reg.descripcion,
              empresaReceptora: reg.empresa,
              // Con un único sustento se puede verificar integridad contra el hash guardado.
              hashGuardado: (reg.sustentos?.length ?? 0) === 1 ? (reg.sustentos?.[0]?.hash ?? null) : null,
              proyecto: { codigo: reg.proyectoCodigo, nombre: reg.proyectoNombre },
            },
            archivos: archivosNombres,
          };
          // El id corto evita colisiones cuando el envío trae varios registros
          // del mismo día y proyecto (cada uno debe analizarse por separado).
          const casoArchivo = `${slug}-${reg.fecha}-${reg.proyectoCodigo ?? "spro"}-${reg.id.slice(0, 8)}.json`;
          await writeFile(join(envioDir, casoArchivo), JSON.stringify(caso, null, 2), "utf8");
          return `casos/envios/${slug}/${casoArchivo}`;
        }),
      );

      // 2. Ejecutar el agente con el flag --lote (informe consolidado único).
      // Node directo (sin npm) y --lote-sin-pdf: el PDF se renderiza al aprobar,
      // no aquí — el HTML que abre el editor es lo único que se necesita ya.
      // SUPABASE_TOKEN: el CLI lo usa para recuperar el contexto RAG (spec 002).
      const resultado = await new Promise<{ ok: boolean; salida: string }>((resolverFn) => {
        const proc = spawn(process.execPath, [join("src", "cli.mjs"), ...casosArg, "--lote", "--lote-sin-pdf"], {
          cwd: agenteDir,
          env: { ...process.env, FORCE_COLOR: "0", SUPABASE_TOKEN: data.token ?? "" },
        });
        let salida = "";
        proc.stdout.on("data", (d: Buffer) => (salida += d.toString()));
        proc.stderr.on("data", (d: Buffer) => (salida += d.toString()));
        proc.on("error", (err) => resolverFn({ ok: false, salida: `No se pudo lanzar npm: ${err.message}` }));
        proc.on("close", (code) =>
          resolverFn({
            ok: code === 0,
            salida: salida || (code === 0 ? "Análisis completado." : `Exit code ${code}`),
          }),
        );
      });
      if (!resultado.ok) return { ok: false, salida: resultado.salida };
      // Redundancia del MaaS: el CLI imprime los avisos de cambio de modelo
      // en stdout ("Cambio de modelo: …") — se separan para el toast de la UI.
      const avisosModelo = [...resultado.salida.matchAll(/Cambio de modelo: [^\r\n]*/g)].map((x) => x[0].trim());

      // 3. Leer el manifest y devolver el PDF del envío (un informe por colaborador+día).
      const fechaEnvio = data.registros[0]?.fecha ?? "";
      const pdfArchivo = await encontrarPdfLote(publicDir, data.colaborador, fechaEnvio);

      // 4. RAG (spec 002): indexar el informe generado en la base de
      //    conocimiento. Mejor esfuerzo — el informe ya está publicado; si
      //    falla (sin MaaS, sin tabla, error de red) solo queda en el log.
      try {
        const entradaLote = await entradaLoteManifest(publicDir, data.colaborador, fechaEnvio);
        if (entradaLote?.htmlArchivo) {
          const html = await readFile(join(publicDir, "informes", entradaLote.htmlArchivo), "utf8");
          const { indexarInforme } = await import("../../agente-sustentos/src/rag.mjs");
          const rag = await indexarInforme({
            html,
            colaborador: data.colaborador,
            fecha: fechaEnvio,
            fuente: entradaLote.htmlArchivo,
            token: data.token,
          });
          console.log(
            rag.ok
              ? `[analizarEnvio] RAG: ${rag.fragmentos} fragmento(s) indexados (${entradaLote.htmlArchivo})`
              : `[analizarEnvio] RAG omitido: ${rag.motivo}`,
          );
        } else {
          console.log("[analizarEnvio] RAG omitido: no se encontró el HTML del informe en el manifest.");
        }
      } catch (e) {
        console.error("[analizarEnvio] RAG (omitido):", e);
      }
      return { ok: true, salida: resultado.salida, pdfArchivo: pdfArchivo ?? undefined, avisosModelo };
    } catch (e) {
      console.error("[analizarEnvio] Error:", e);
      return { ok: false, salida: `Error inesperado: ${(e as Error).message}` };
    }
  });

interface AprobarInput {
  /** "registro" (individual, por defecto) o "lote" (informe consolidado del envío). */
  tipo?: "registro" | "lote";
  /** Para lote: día de trabajo del envío; para registro: fecha del registro. */
  fecha: string;
  colaborador: string;
  proyectoCodigo: string;
  html: string;
  aprobador: string;
  rol: string;
  /** Token de Supabase de la sesión (solo se usa en Vercel, para Storage). */
  token?: string;
}

interface AprobarResultado {
  ok: boolean;
  pdfArchivo?: string;
  error?: string;
}

const NAVEGADORES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function buscarNavegador(): string | null {
  return NAVEGADORES.find((n) => existsSync(n)) ?? null;
}

function htmlAPdf(navegador: string, rutaHtml: string, rutaPdf: string, perfil: string): Promise<void> {
  return new Promise((resolver, rechazar) => {
    execFile(
      navegador,
      [
        "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${perfil}`,
        `--print-to-pdf=${rutaPdf}`, pathToFileURL(rutaHtml).href,
      ],
      { timeout: 60000, windowsHide: true },
      (error) => (error ? rechazar(error) : resolver()),
    );
  });
}

/**
 * Añade al pie de página del informe la marca de aprobación:
 * "Generado … - Aprobado <fecha> - Aprobado por <nombre> (<rol>)".
 * Si el pie ya tiene una marca de aprobación previa, no la duplica.
 */
function sellarPie(html: string, aprobador: string, rol: string): string {
  const fecha = new Date().toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" });
  const sello = ` - Aprobado ${fecha} - Aprobado por ${aprobador} (${rol})`;

  // <footer …>…</footer> — buscar el cierre del footer y appendar el sello.
  const match = html.match(/(<footer[^>]*>)([\s\S]*?)(<\/footer>)/i);
  if (!match) return html;
  const apertura = match[1] ?? "";
  const contenido = match[2] ?? "";
  const cierre = match[3] ?? "";
  if (contenido.includes("Aprobado por")) return html; // ya sellado
  return html.replace(match[0], `${apertura}${contenido.trimEnd()}${sello}\n  ${cierre}`);
}

/**
 * Toma el HTML editado por el usuario, lo convierte a PDF con Chrome/Edge
 * headless, guarda el PDF en public/informes/ y marca la entrada del
 * manifest como aprobado: true.
 */
export const aprobarInforme = createServerFn({ method: "POST" })
  .validator((input: AprobarInput) => input)
  .handler(async ({ data }): Promise<AprobarResultado> => {
    try {
      // ─── Vercel: sella el HTML y publica la versión aprobada como archivos
      // NUEVOS (el bucket no permite UPDATE); el companion más reciente gana
      // en el manifest. Sin Chrome en el servidor, el PDF final lo imprime el
      // navegador (botón en el informe). ───
      if (EN_VERCEL) {
        if (!data.token) return { ok: false, error: "Falta la sesión de Supabase (token)." };
        const manifest = await manifestDesdeStorage(data.token);
        const nombreBuscado = sinTildes(data.colaborador);
        const coincide = (m: ManifestEntrada) =>
          sinTildes(m.colaborador ?? "").split(/\s+/).every((p) => nombreBuscado.includes(p));
        const entrada = manifest.find(
          (m) =>
            (data.tipo === "lote"
              ? m.tipo === "lote"
              : (m.tipo ?? "registro") !== "lote" && m.proyecto === data.proyectoCodigo) &&
            m.fecha === data.fecha &&
            coincide(m),
        );
        if (!entrada) return { ok: false, error: "No se encontró el informe en el manifest." };
        const htmlViejo = entrada.htmlArchivo ?? entrada.archivo?.replace(/\.pdf$/, ".html");
        if (!htmlViejo) return { ok: false, error: "La entrada del manifest no tiene nombre de informe." };
        const hhmmss = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
        const base = `${htmlViejo.replace(/\.html$/, "")}-aprobado-${hhmmss}`;
        const nuevaEntrada: ManifestEntrada = {
          ...entrada,
          aprobado: true,
          sinPdf: true,
          archivo: `${base}.pdf`,
          htmlArchivo: `${base}.html`,
        };
        await subirStorage(
          data.token,
          nuevaEntrada.htmlArchivo ?? "",
          Buffer.from(sellarPie(data.html, data.aprobador, data.rol), "utf8"),
        );
        await subirStorage(
          data.token,
          `${base}.json`,
          Buffer.from(JSON.stringify(nuevaEntrada), "utf8"),
        );
        return { ok: true, pdfArchivo: nuevaEntrada.archivo };
      }

      const publicDir = resolve(process.cwd(), "public");
      const informesDir = join(publicDir, "informes");
      const manifestPath = join(informesDir, "manifest.json");

      // 1. Leer manifest y encontrar la entrada correspondiente
      let manifest: Array<{
        tipo?: string; proyecto?: string; fecha?: string; colaborador?: string;
        periodo?: string; archivo?: string; htmlArchivo?: string; aprobado?: boolean;
      }> = [];
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch {
        return { ok: false, error: "No se pudo leer el manifest." };
      }
      if (!Array.isArray(manifest)) return { ok: false, error: "Manifest inválido." };

      const nombreBuscado = sinTildes(data.colaborador);
      const coincideColaborador = (m: { colaborador?: string }) =>
        sinTildes(m.colaborador ?? "").split(/\s+/).every((p: string) => nombreBuscado.includes(p));
      const indice =
        data.tipo === "lote"
          ? manifest.findIndex((m) => m.tipo === "lote" && m.fecha === data.fecha && coincideColaborador(m))
          : manifest.findIndex(
              (m) =>
                (m.tipo ?? "registro") !== "lote" &&
                m.proyecto === data.proyectoCodigo &&
                m.fecha === data.fecha &&
                coincideColaborador(m),
            );
      if (indice === -1) return { ok: false, error: "No se encontró el informe en el manifest." };

      // 2. Escribir el HTML editado a un archivo temporal
      const navegador = buscarNavegador();
      if (!navegador) return { ok: false, error: "No se encontró Edge ni Chrome." };

      await mkdir(informesDir, { recursive: true });
      const perfil = await mkdtemp(join(tmpdir(), "aprobar-perfil-"));
      const entrada = manifest[indice];
      if (!entrada?.archivo) return { ok: false, error: "La entrada del manifest no tiene nombre de PDF." };
      const pdfArchivo = entrada.archivo;
      const rutaPdf = join(informesDir, pdfArchivo);
      const rutaHtmlTmp = join(perfil, "editado.html");

      try {
        // Sellar el pie de página con la fecha de aprobación y el aprobador.
        const htmlSellado = sellarPie(data.html, data.aprobador, data.rol);
        await writeFile(rutaHtmlTmp, htmlSellado, "utf8");
        await htmlAPdf(navegador, rutaHtmlTmp, rutaPdf, perfil);
        if (!existsSync(rutaPdf)) throw new Error("El navegador no generó el PDF.");

        // 3. Actualizar manifest: marcar como aprobado
        manifest[indice] = { ...entrada, aprobado: true };
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

        return { ok: true, pdfArchivo };
      } catch (e) {
        console.error("[aprobarInforme] Error al generar PDF:", e);
        return { ok: false, error: `Error al generar PDF: ${(e as Error).message}` };
      } finally {
        await rm(perfil, { recursive: true, force: true }).catch(() => {});
      }
    } catch (e) {
      console.error("[aprobarInforme] Error inesperado:", e);
      return { ok: false, error: `Error inesperado: ${(e as Error).message}` };
    }
  });

interface TokenInput {
  token?: string;
}

/**
 * Manifest de informes IA para la UI. Local: public/informes/manifest.json;
 * Vercel: informes-ia/manifest.json en Storage (permisos del usuario logueado).
 */
export const leerManifestIA = createServerFn({ method: "POST" })
  .validator((input: TokenInput) => input)
  .handler(async ({ data }): Promise<unknown[]> => {
    try {
      if (EN_VERCEL) {
        if (!data.token) return [];
        return await manifestDesdeStorage(data.token);
      }
      const manifest = JSON.parse(await readFile(manifestLocal(), "utf8"));
      return Array.isArray(manifest) ? manifest : [];
    } catch {
      return [];
    }
  });

interface LeerInformeInput {
  token?: string;
  archivo: string;
}

interface LeerInformeResultado {
  ok: boolean;
  contenidoBase64?: string;
  tipoMime?: string;
  error?: string;
}

/**
 * Devuelve el contenido de un informe IA (HTML o PDF) como base64. La UI lo
 * convierte a blob para abrirlo o editarlo — así funciona igual en local
 * (disco) y en Vercel (Storage), sin depender de rutas estáticas.
 */
export const leerInformeIA = createServerFn({ method: "POST" })
  .validator((input: LeerInformeInput) => input)
  .handler(async ({ data }): Promise<LeerInformeResultado> => {
    try {
      // Solo nombres planos: sin barras ni ".." (el nombre viene del manifest).
      if (!/^[\w .-]+\.(html|pdf|json)$/i.test(data.archivo)) {
        return { ok: false, error: "Nombre de archivo inválido." };
      }
      let bytes: Buffer | null = null;
      if (EN_VERCEL) {
        if (!data.token) return { ok: false, error: "Falta la sesión de Supabase (token)." };
        bytes = await bajarStorage(data.token, data.archivo);
      } else {
        bytes = await readFile(join(resolve(process.cwd(), "public"), "informes", data.archivo)).catch(
          () => null,
        );
      }
      if (!bytes) return { ok: false, error: "Informe no encontrado." };
      return {
        ok: true,
        contenidoBase64: bytes.toString("base64"),
        tipoMime: data.archivo.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/html; charset=utf-8",
      };
    } catch (e) {
      return { ok: false, error: `Error inesperado: ${(e as Error).message}` };
    }
  });
