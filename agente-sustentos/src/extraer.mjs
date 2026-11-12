import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import JSZip from "jszip";

/** Formatos aceptados por Sustenta como evidencia (Manual, Anexo A.2). */
const MIME_NATIVO = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const TEXTO = new Set([".xlsx", ".docx", ".pptx"]);

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function xlsxATexto(buffer) {
  const libro = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const datos = [];
  // Las hojas pueden traer filas de título antes de los encabezados:
  // se vuelca cada hoja completa como filas, sin suponer cabecera en la fila 1.
  const texto = libro.SheetNames.map((nombre) => {
    const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], {
      header: 1,
      blankrows: false,
      raw: false,
    });
    // Filas de datos = las de 2+ celdas; así un título suelto no altera la huella de contenido.
    for (const f of filas) if (f.filter((c) => c !== undefined && c !== "").length >= 2) datos.push(f.join("|"));
    const cuerpo = filas.map((f, i) => `${i + 1}: ${f.map((c) => c ?? "").join(" | ")}`);
    return `=== HOJA: ${nombre} (${filas.length} filas) ===\n${cuerpo.join("\n")}`;
  }).join("\n\n");
  return { texto, hojas: libro.SheetNames, huellaContenido: sha256(Buffer.from(datos.join("\n"))) };
}

const normalizar = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();

async function docxATexto(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function pptxATexto(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const laminas = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const salida = [];
  for (const nombre of laminas) {
    const xml = await zip.files[nombre].async("string");
    const textos = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    salida.push(`=== LÁMINA ${salida.length + 1} ===\n${textos.join("\n")}`);
  }
  return salida.join("\n\n");
}

/**
 * Lee un archivo de sustento y devuelve lo que necesita el agente:
 * hash, tipo, y texto extraído (xlsx/docx/pptx) o bytes para enviar tal cual
 * a la IA de Gemini (pdf/imágenes).
 */
export async function extraer(ruta) {
  const buffer = await readFile(ruta);
  const ext = extname(ruta).toLowerCase();
  const base = { nombre: basename(ruta), ext, hash: sha256(buffer), bytes: buffer.length };

  if (MIME_NATIVO[ext]) {
    return { ...base, modo: "nativo", mime: MIME_NATIVO[ext], buffer, texto: null };
  }
  if (!TEXTO.has(ext)) {
    throw new Error(`Formato no aceptado como evidencia: ${ext || "(sin extensión)"}`);
  }
  if (ext === ".xlsx") {
    const { texto, hojas, huellaContenido } = xlsxATexto(buffer);
    return { ...base, modo: "texto", mime: null, buffer: null, texto, hojas, huellaContenido };
  }
  const texto = ext === ".docx" ? await docxATexto(buffer) : await pptxATexto(buffer);
  return {
    ...base, modo: "texto", mime: null, buffer: null, texto, hojas: [],
    huellaContenido: sha256(Buffer.from(normalizar(texto))),
  };
}
