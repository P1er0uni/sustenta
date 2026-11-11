import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface RegistroProyecto {
  fecha: string;
  horas: number;
  colaborador: string;
  proyecto_codigo: string | null;
  proyecto_nombre: string | null;
}

interface ManifestEntrada {
  tipo?: string;
  fecha?: string;
  colaborador?: string;
  archivo?: string;
}

interface ExpedientePdfInput {
  expedienteId: string;
  /** HTML ya renderizado del documento (lo envía el cliente). */
  html: string;
}

interface ExpedientePdfResultado {
  ok: boolean;
  pdfArchivo?: string;
  error?: string;
}

// ─── Navegador headless ──────────────────────────────────────────────────────

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
        "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
        `--user-data-dir=${perfil}`,
        `--print-to-pdf=${rutaPdf}`,
        pathToFileURL(rutaHtml).href,
      ],
      { timeout: 60000, windowsHide: true },
      (error) => (error ? rechazar(error) : resolver()),
    );
  });
}

// ─── Función servidor ────────────────────────────────────────────────────────

/**
 * Recibe el HTML ya renderizado del expediente (con las secciones III y IV nuevas),
 * lo convierte a PDF con Edge/Chrome headless y lo guarda en public/expedientes/.
 */
export const generarPdfExpediente = createServerFn({ method: "POST" })
  .validator((input: ExpedientePdfInput) => input)
  .handler(async ({ data }): Promise<ExpedientePdfResultado> => {
    try {
      const publicDir = resolve(process.cwd(), "public");
      const expedientesDir = join(publicDir, "expedientes");
      await mkdir(expedientesDir, { recursive: true });

      const navegador = buscarNavegador();
      if (!navegador) return { ok: false, error: "No se encontró Edge ni Chrome." };

      const pdfArchivo = `expediente-${data.expedienteId}.pdf`;
      const rutaPdf = join(expedientesDir, pdfArchivo);

      const perfil = await mkdtemp(join(tmpdir(), "expediente-pdf-"));
      const rutaHtmlTmp = join(perfil, "expediente.html");

      try {
        await writeFile(rutaHtmlTmp, data.html, "utf8");
        await htmlAPdf(navegador, rutaHtmlTmp, rutaPdf, perfil);
        if (!existsSync(rutaPdf)) throw new Error("El navegador no generó el PDF.");
        return { ok: true, pdfArchivo };
      } finally {
        await rm(perfil, { recursive: true, force: true }).catch(() => {});
      }
    } catch (e) {
      console.error("[generarPdfExpediente] Error:", e);
      return { ok: false, error: `Error al generar PDF: ${(e as Error).message}` };
    }
  });
