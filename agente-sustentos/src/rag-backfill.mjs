import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maasConfigurado } from "./maas.mjs";
import { fuentesExistentes, indexarInforme } from "./rag.mjs";

/**
 * Backfill del RAG (spec 002): indexa en la base de conocimiento los informes
 * IA que ya existen en la réplica local de la app (public/informes, según su
 * manifest.json). Idempotente por fuente: los ya indexados se saltan.
 *
 * Uso (desde agente-sustentos/, con el MaaS configurado en .env):
 *   SUPABASE_TOKEN=<access_token_de_sesion> node src/rag-backfill.mjs
 *
 * El token es el access_token de Supabase de una sesión iniciada en la app
 * (p. ej. de la cuenta demo): las subidas heredan sus permisos (RLS).
 * Los informes que viven en Storage (Vercel) no están en este manifest local;
 * para esos, generar de nuevo o indexar manualmente.
 */

const publico = fileURLToPath(new URL("../../public/", import.meta.url));
const manifestPath = join(publico, "informes", "manifest.json");

if (!existsSync(manifestPath)) {
  console.log(`No se encontró ${manifestPath}: no hay informes locales para indexar.`);
  process.exit(0);
}

const token = process.env.SUPABASE_TOKEN || "";
if (!token) {
  console.log("Falta SUPABASE_TOKEN (access_token de una sesión de la app).");
  process.exit(1);
}
if (!maasConfigurado()) {
  console.log(
    "Falta configurar los embeddings: MAAS_API_KEY y MAAS_BASE_URL (MaaS de Huawei) o MAAS_PROVEEDOR=gemini con GEMINI_API_KEY.",
  );
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const informes = (Array.isArray(manifest) ? manifest : []).filter(
  (m) => m && (m.htmlArchivo ?? m.archivo),
);

let hechas = 0;
const ya = new Set(await fuentesExistentes(token).catch((e) => {
  console.log(`No se pudo leer el índice en Storage (${e.message}).`);
  process.exit(1);
}));

for (const entrada of informes) {
  const htmlArchivo = entrada.htmlArchivo ?? entrada.archivo.replace(/\.pdf$/, ".html");
  if (ya.has(htmlArchivo)) {
    console.log(`· ${htmlArchivo}: ya indexado, se omite.`);
    continue;
  }
  const ruta = resolve(publico, "informes", htmlArchivo);
  if (!existsSync(ruta)) {
    console.log(`· ${htmlArchivo}: no existe el HTML en public/informes, se omite.`);
    continue;
  }
  const html = await readFile(ruta, "utf8");
  const res = await indexarInforme({
    html,
    colaborador: entrada.colaborador ?? null,
    fecha: entrada.fecha ?? entrada.periodo ?? null,
    fuente: htmlArchivo,
    token,
  });
  console.log(`· ${htmlArchivo}: ${res.ok ? `${res.fragmentos} fragmento(s) indexados` : `ERROR — ${res.motivo}`}`);
  if (res.ok) hechas++;
}

console.log(`\nBackfill terminado: ${hechas} informe(s) indexado(s).`);
