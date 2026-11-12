import { test } from "node:test";
import assert from "node:assert/strict";
import {
  htmlATexto,
  fragmentar,
  indexarInforme,
  recuperarContextoEnvio,
  similitudCoseno,
  nombreRag,
  fuenteDeNombre,
} from "../src/rag.mjs";
import { maasConfigurado, incrustar } from "../src/maas.mjs";
import { config } from "../src/config.mjs";

// RAG (spec 002). Las pruebas de red (embeddings reales + Storage) requieren
// credenciales del proveedor activo (MAAS_* o MAAS_PROVEEDOR=gemini) y los
// archivos .rag en Storage; aquí se cubre lo que siempre debe cumplirse: las
// funciones puras y la degradación elegante sin configuración — el RAG nunca
// debe romper el flujo principal. Con credenciales en .env, las pruebas de
// degradación se saltan (skip) para no gastar API.

test("htmlATexto: quita tags, scripts, estilos y entidades", () => {
  const html = `<html><head><style>body{color:red}</style><script>alert(1)</script></head>
    <body><h1>Informe de análisis</h1><p>Registro&nbsp;de&nbsp;horas &amp; sustento</p>
    <table><tr><td>Fecha</td></tr></table></body></html>`;
  const texto = htmlATexto(html);
  assert.ok(!texto.includes("<"), "no debe quedar ningún tag");
  assert.ok(!texto.includes("alert"), "el script se descarta");
  assert.ok(!texto.includes("color:red"), "el style se descarta");
  assert.ok(texto.includes("Informe de análisis"));
  assert.ok(texto.includes("Registro de horas & sustento"), "decodifica &nbsp; y &amp;");
});

test("fragmentar: respeta el tamaño máximo y avanza siempre", () => {
  const texto = "palabra ".repeat(600); // 4800 caracteres
  const trozos = fragmentar(texto, { max: 1000, solape: 150 });
  assert.ok(trozos.length >= 4, "divide el texto");
  for (const t of trozos) assert.ok(t.length <= 1000, `fragmento de ${t.length} > max`);
  // Todos los fragmentos concatenados cubren el texto (con solape).
  assert.ok(trozos[0].length > 0);
  assert.ok(trozos[trozos.length - 1].includes("palabra"));
  // Texto corto: un solo fragmento.
  assert.deepEqual(fragmentar("hola mundo"), ["hola mundo"]);
  assert.deepEqual(fragmentar(""), []);
});

test("sin embeddings configurados: maasConfigurado() es false e incrustar explica qué falta", { skip: maasConfigurado() }, async () => {
  await assert.rejects(incrustar(["hola"]), /no configurado/i);
});

test("sin embeddings configurados: indexarInforme degrada sin lanzar", { skip: maasConfigurado() }, async () => {
  const res = await indexarInforme({ html: "<p>hola</p>", colaborador: "X", fecha: "2026-11-11", fuente: "a.html", token: "tok" });
  assert.equal(res.ok, false);
  assert.match(res.motivo, /no configurado|token/i);
});

test("sin token ni embeddings: recuperarContextoEnvio devuelve [] sin lanzar", { skip: maasConfigurado() }, async () => {
  assert.deepEqual(await recuperarContextoEnvio({ colaborador: "X", fecha: "2026-11-11", registros: [], token: "" }), []);
  assert.deepEqual(await recuperarContextoEnvio({ colaborador: "X", fecha: "2026-11-11", registros: [], token: "tok" }), []);
});

test("similitudCoseno: 1 en la misma dirección, 0 en ortogonales, 0 sin vector válido", () => {
  assert.ok(Math.abs(similitudCoseno([1, 2, 3], [2, 4, 6]) - 1) < 1e-9, "misma dirección → 1");
  assert.ok(Math.abs(similitudCoseno([1, 0], [0, 1])) < 1e-9, "ortogonales → 0");
  assert.ok(Math.abs(similitudCoseno([1, 0], [-1, 0]) + 1) < 1e-9, "opuestos → -1");
  assert.ok(Math.abs(similitudCoseno([1, 2], [2, 4, 6]) - 1) < 1e-9, "dimensiones distintas: usa el tramo común");
  assert.equal(similitudCoseno([], [1]), 0, "vector vacío → 0");
  assert.equal(similitudCoseno(null, [1]), 0, "sin vector → 0");
  assert.equal(similitudCoseno([0, 0], [1, 1]), 0, "vector nulo → 0 (sin dividir entre cero)");
});

test("nombreRag/fuenteDeNombre: ida y vuelta con etiqueta de proveedor", () => {
  const sufijo = `.${config.maas.proveedor}.rag`;
  assert.equal(nombreRag("informe-envio-juan-pablo-2026-09-02.html"), `rag-informe-envio-juan-pablo-2026-09-02${sufijo}`);
  assert.equal(fuenteDeNombre(`rag-informe-envio-juan-pablo-2026-09-02${sufijo}`), "informe-envio-juan-pablo-2026-09-02.html");
  // La etiqueta permite que convivan índices de dos proveedores (pruebas con
  // gemini / producción con maas) sin chocar: el bucket es append-only.
  assert.equal(fuenteDeNombre("rag-informe-x.gemini.rag"), "informe-x.html");
  assert.equal(fuenteDeNombre("rag-informe-x.maas.rag"), "informe-x.html");
  // El nombre nunca sale del prefijo informes-ia/ ni gana extensiones raras.
  assert.equal(nombreRag("a b/c.html"), `rag-a-b-c${sufijo}`);
  assert.ok(!nombreRag("x.html").includes("/"));
});
