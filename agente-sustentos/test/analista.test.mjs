import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearJsonSalida, construirMensajes, consultarMaas, consultarMaasResumen } from "../src/maas-llm.mjs";
import { esMaas, modeloAnalista, analistaConfigurado, mensajeAnalistaNoConfigurado } from "../src/analista.mjs";
import { config } from "../src/config.mjs";

// Dispatcher del análisis (analista.mjs) + capa MaaS de Huawei (maas-llm.mjs).
// Sin credenciales del MaaS en .env se prueban los mensajes claros de falta
// de configuración; con credenciales esas pruebas se saltan (skip) para no
// gastar API — lo que siempre debe cumplirse es la construcción de mensajes,
// el parseo tolerante y la elección de proveedor.

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

test("parsearJsonSalida: JSON directo, con cerca ```json y con texto alrededor", () => {
  assert.deepEqual(parsearJsonSalida('{"veredicto":"sustenta"}'), { veredicto: "sustenta" });
  assert.deepEqual(parsearJsonSalida('```json\n{"veredicto":"sustenta"}\n```'), { veredicto: "sustenta" });
  assert.deepEqual(
    parsearJsonSalida('Claro, aquí tienes:\n{"veredicto":"sustenta","confianza":"alta"}\nEspero te sirva.'),
    { veredicto: "sustenta", confianza: "alta" },
  );
  assert.throws(() => parsearJsonSalida("no hay json aquí"), /no es JSON válido/);
});

test("construirMensajes: texto, PDF e imagen según el modo multimodal", () => {
  const textosPdf = new Map([["acta.pdf", "Acta de reunión de coordinación."]]);
  const { sistema, usuario } = construirMensajes(
    registro,
    [archivoTexto, archivoPdf, archivoImagen],
    { conMultimodal: true, textosPdf },
  );
  // El sistema lleva la instrucción + el esquema como texto.
  assert.ok(sistema.includes("revisor de registros de horas"));
  assert.ok(sistema.includes("JSON"));
  // Registro + texto del xlsx + texto extraído del PDF + imagen en data URL.
  assert.ok(usuario.some((p) => p.type === "text" && p.text.includes("REGISTRO DE HORAS A SUSTENTAR")));
  assert.ok(usuario.some((p) => p.type === "text" && p.text.includes("Ingresos")));
  assert.ok(usuario.some((p) => p.type === "text" && p.text.includes("Acta de reunión")));
  const imagen = usuario.find((p) => p.type === "image_url");
  assert.ok(imagen, "la imagen va como image_url en modo multimodal");
  assert.match(imagen.image_url.url, /^data:image\/png;base64,/);

  // Modo degradado (modelo sin visión): la imagen se vuelve nota de texto.
  const sinMm = construirMensajes(registro, [archivoImagen], { conMultimodal: false, textosPdf });
  assert.ok(sinMm.usuario.every((p) => p.type === "text"));
  assert.ok(sinMm.usuario.some((p) => p.text.includes("no admite imágenes")));

  // PDF sin texto extraíble (escaneado): nota que guía al veredicto ilegible.
  const escaneado = construirMensajes(registro, [archivoPdf], {
    conMultimodal: true,
    textosPdf: new Map([["acta.pdf", null]]),
  });
  assert.ok(escaneado.usuario.some((p) => p.text.includes("sin texto extraíble")));
});

test("analista: el modelo por defecto y el mensaje de falta de config siguen al proveedor del análisis (IA_PROVEEDOR)", () => {
  if (esMaas()) {
    assert.equal(modeloAnalista(), config.maas.modeloAnalisis);
    assert.match(mensajeAnalistaNoConfigurado(), /MAAS_API_KEY/);
  } else {
    assert.equal(modeloAnalista(), config.modelo);
    assert.match(mensajeAnalistaNoConfigurado(), /GEMINI_API_KEY/);
  }
  // analistaConfigurado refleja si el proveedor del análisis tiene credenciales.
  assert.equal(
    analistaConfigurado(),
    esMaas()
      ? Boolean(config.maas.apiKey && config.maas.baseUrl && config.maas.modeloAnalisis)
      : Boolean(config.apiKey),
  );
});

test("sin credenciales del MaaS: consultarMaas explica qué falta", { skip: Boolean(config.maas.apiKey && config.maas.baseUrl) }, async () => {
  await assert.rejects(consultarMaas({ registro, archivos: [], modelo: "modelo-de-prueba" }), /MAAS_API_KEY/);
  await assert.rejects(
    consultarMaasResumen({ colaborador: "X", fecha: "2026-11-05", resultados: [], modelo: "modelo-de-prueba" }),
    /MAAS_API_KEY/,
  );
});

test("MaaS sin modelo de análisis: exige MAAS_ANALISIS_MODEL antes de llamar", { skip: Boolean(config.maas.modeloAnalisis) }, async () => {
  await assert.rejects(consultarMaas({ registro, archivos: [] }), /MAAS_ANALISIS_MODEL/);
});
