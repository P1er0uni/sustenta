import { test } from "node:test";
import assert from "node:assert/strict";
import { construirContenido, consultarOpenAI, consultarOpenAIResumen } from "../src/openai.mjs";
import { modeloAnalista, analistaConfigurado, mensajeAnalistaNoConfigurado } from "../src/analista.mjs";
import { config } from "../src/config.mjs";

// Dispatcher del análisis (analista.mjs) + capa OpenAI (openai.mjs).
// Sin credenciales en .env se prueban los mensajes claros de falta de
// configuración; con credenciales esas pruebas se saltan (skip) para no
// gastar API — lo que siempre debe cumplirse es la construcción del
// contenido de la llamada y la config del proveedor.

const registro = {
  id: "reg-1",
  fecha: "2026-11-05",
  horas: 8,
  colaborador: "Juan Pablo Pérez Reyes",
  actividad: "Análisis financiero",
  proyecto: { codigo: "90001", nombre: "Reporte Contable" },
};

const archivoTexto = {
  nombre: "registro.xlsx",
  ext: ".xlsx",
  hash: "a".repeat(64),
  bytes: 100,
  modo: "texto",
  texto: "HOJA: Datos\n1: Ingresos | 4500",
};
const archivoPdf = {
  nombre: "acta.pdf",
  ext: ".pdf",
  hash: "b".repeat(64),
  bytes: 200,
  modo: "nativo",
  mime: "application/pdf",
  buffer: Buffer.from("%PDF-falso"),
};
const archivoImagen = {
  nombre: "captura.png",
  ext: ".png",
  hash: "c".repeat(64),
  bytes: 50,
  modo: "nativo",
  mime: "image/png",
  buffer: Buffer.from("png"),
};

test("construirContenido: texto, PDF como input_file e imagen como input_image", () => {
  const contenido = construirContenido(registro, [archivoTexto, archivoPdf, archivoImagen]);
  // Registro + texto del xlsx + PDF e imagen nativos en línea.
  assert.ok(contenido.some((p) => p.type === "input_text" && p.text.includes("REGISTRO DE HORAS A SUSTENTAR")));
  assert.ok(contenido.some((p) => p.type === "input_text" && p.text.includes("Ingresos")));
  const pdf = contenido.find((p) => p.type === "input_file");
  assert.ok(pdf, "el PDF va como input_file");
  assert.equal(pdf.filename, "acta.pdf");
  assert.match(pdf.file_data, /^data:application\/pdf;base64,/);
  const imagen = contenido.find((p) => p.type === "input_image");
  assert.ok(imagen, "la imagen va como input_image");
  assert.match(imagen.image_url, /^data:image\/png;base64,/);
  // Cierra pidiendo el veredicto.
  assert.ok(contenido.at(-1).text.includes("Emite el veredicto."));
});

test("analista: modelo por defecto, config y mensaje de falta de OPENAI_API_KEY", () => {
  assert.equal(modeloAnalista(), config.openai.modelo);
  assert.equal(analistaConfigurado(), Boolean(config.openai.apiKey));
  assert.match(mensajeAnalistaNoConfigurado(), /OPENAI_API_KEY/);
});

test("sin credenciales: consultarOpenAI explica qué falta", { skip: Boolean(config.openai.apiKey) }, async () => {
  await assert.rejects(consultarOpenAI({ registro, archivos: [], modelo: "modelo-de-prueba" }), /OPENAI_API_KEY/);
  await assert.rejects(
    consultarOpenAIResumen({ colaborador: "X", fecha: "2026-11-05", resultados: [], modelo: "modelo-de-prueba" }),
    /OPENAI_API_KEY/,
  );
});
