import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsearJsonSalida,
  construirMensajes,
  consultarMaas,
  consultarMaasResumen,
  esErrorDeDisponibilidad,
  conRedundancia,
  avisosDeCambioDeModelo,
  limpiarCambiosDeModelo,
} from "../src/maas-llm.mjs";
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
    esMaas() ? Boolean(config.maas.apiKey && config.maas.baseUrl) : Boolean(config.apiKey),
  );
});

test("sin credenciales del MaaS: consultarMaas explica qué falta", { skip: Boolean(config.maas.apiKey && config.maas.baseUrl) }, async () => {
  await assert.rejects(consultarMaas({ registro, archivos: [], modelo: "modelo-de-prueba" }), /MAAS_API_KEY/);
  await assert.rejects(
    consultarMaasResumen({ colaborador: "X", fecha: "2026-11-05", resultados: [], modelo: "modelo-de-prueba" }),
    /MAAS_API_KEY/,
  );
});

// ─── Redundancia de modelos (cadena glm-5.3 → glm-5.2 → deepseek-v4.1-flash) ───

test("esErrorDeDisponibilidad: 404/429/5xx/red sí; 400/401/403 no", () => {
  const con = (status) => Object.assign(new Error("x"), { status });
  assert.equal(esErrorDeDisponibilidad(con(404)), true);
  assert.equal(esErrorDeDisponibilidad(con(429)), true);
  assert.equal(esErrorDeDisponibilidad(con(500)), true);
  assert.equal(esErrorDeDisponibilidad(con(503)), true);
  assert.equal(esErrorDeDisponibilidad(new Error("Connection error")), true); // red: sin status
  assert.equal(esErrorDeDisponibilidad(con(400)), false); // contenido: se degrada
  assert.equal(esErrorDeDisponibilidad(con(422)), false); // parámetros: se degrada
  assert.equal(esErrorDeDisponibilidad(con(401)), false); // credenciales: no hay modelo que lo arregle
  assert.equal(esErrorDeDisponibilidad(con(403)), false);
});

test("cadena de redundancia: 2 intentos por modelo, luego cae al siguiente y avisa", async () => {
  limpiarCambiosDeModelo();
  const llamadas = [];
  const { resultado, modelo } = await conRedundancia({
    modelo: "primario-falso",
    llamar: async (m) => {
      llamadas.push(m);
      if (m === "primario-falso") throw Object.assign(new Error("Service unavailable"), { status: 503 });
      return `ok-${m}`;
    },
  });
  // El primario se intentó exactamente 2 veces antes de caer al siguiente.
  assert.equal(llamadas.filter((m) => m === "primario-falso").length, 2);
  assert.equal(llamadas.length, 3);
  assert.equal(modelo, llamadas[2]);
  assert.equal(resultado, `ok-${modelo}`);
  // El aviso quedó en la bitácora, en claro y con el motivo.
  const avisos = avisosDeCambioDeModelo();
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Cambio de modelo: primario-falso no disponible \(HTTP 503/);
  assert.match(avisos[0], new RegExp(`usando ${modelo}\\.`));
  // Varios registros en paralelo que caen al mismo cambio: un solo aviso.
  await conRedundancia({
    modelo: "primario-falso",
    llamar: async (m) => {
      if (m === "primario-falso") throw Object.assign(new Error("Service unavailable"), { status: 503 });
      return "ok";
    },
  });
  assert.equal(avisosDeCambioDeModelo().length, 1);
});

test("cadena de redundancia: un timeout no se reintenta — cae directo al siguiente", async () => {
  limpiarCambiosDeModelo();
  const llamadas = [];
  const { modelo } = await conRedundancia({
    modelo: "lento-falso",
    llamar: async (m) => {
      llamadas.push(m);
      if (m === "lento-falso") throw new Error("Request timed out.");
      return "ok";
    },
  });
  // El timeout ya quemó el tiempo del intento: 1 sola llamada al primario.
  assert.equal(llamadas.filter((m) => m === "lento-falso").length, 1);
  assert.equal(modelo, llamadas[1]);
  assert.match(avisosDeCambioDeModelo()[0], /lento-falso no disponible \(Request timed out\./);
});

test("cadena de redundancia: errores de contenido (400) y credenciales (401) no cambian de modelo", async () => {
  limpiarCambiosDeModelo();
  const llamadas = [];
  await assert.rejects(
    conRedundancia({
      modelo: "primario",
      llamar: async (m) => {
        llamadas.push(m);
        throw Object.assign(new Error("unsupported content type"), { status: 400 });
      },
    }),
    /unsupported content type/,
  );
  assert.equal(llamadas.length, 1); // ni reintento ni cambio: lo maneja la degradación de modos
  await assert.rejects(
    conRedundancia({
      modelo: "primario",
      llamar: async (m) => {
        llamadas.push(m);
        throw Object.assign(new Error("bad key"), { status: 401 });
      },
    }),
    /bad key/,
  );
  assert.equal(llamadas.length, 2);
  assert.deepEqual(avisosDeCambioDeModelo(), []);
});

test("cadena de redundancia: cadena agotada lanza el último error tras 2 intentos por modelo", async () => {
  limpiarCambiosDeModelo();
  const llamadas = [];
  await assert.rejects(
    conRedundancia({
      modelo: "a-falso",
      llamar: async (m) => {
        llamadas.push(m);
        throw Object.assign(new Error("down"), { status: 503 });
      },
    }),
    /down/,
  );
  // "a-falso" (primario pedido) + el resto de la cadena, 2 intentos cada uno.
  assert.equal(llamadas.length, (1 + config.maas.modelos.length) * 2);
  // Un aviso por cada caída al siguiente modelo.
  assert.equal(avisosDeCambioDeModelo().length, llamadas.length / 2 - 1);
});

test("config: la cadena de redundancia por defecto y su primario", () => {
  // Primario = primer modelo de la cadena; el CLI lo sobreescribe con --modelo.
  assert.equal(config.maas.modeloAnalisis, config.maas.modelos[0]);
  // La cadena por defecto cubre los tres modelos de redundancia.
  for (const m of ["glm-5.3", "glm-5.2", "deepseek-v4.1-flash"]) {
    assert.ok(config.maas.modelos.includes(m), `la cadena incluye ${m}`);
  }
});
