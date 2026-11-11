import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { extraer } from "../src/extraer.mjs";
import { evaluarReglas, periodosEnTexto } from "../src/reglas.mjs";

/** Reconstruye (sintético) la liquidación de agosto 2026 que adjuntó el caso real. */
async function liquidacionSintetica() {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ["Liquidación agosto 2026"],
    ["Empresas incluidas: Todas las empresas"],
    ["Empresa", "Horas cobrables", "Total a facturar"],
    ["AC Retail Perú", 410, 23532.63],
  ]), "Resumen empresa");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ["Empresa", "Proyecto", "Total a facturar"],
    ["AC Retail Perú", "80851", 15065.43],
    ["AC Inmobiliaria", "80902", 2671.2],
  ]), "Resumen proyecto");
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ["Colaborador", "Proyecto", "Empresa", "Fecha", "Horas"],
    ["Óscar Santos", "Contabilidad general", "AC Retail Perú", "2026-08-03", 6],
    ["Óscar Santos", "Cierre tributario", "AC Inmobiliaria", "2026-08-03", 2.4],
  ]), "Detalle");
  const dir = await mkdtemp(join(tmpdir(), "sustentos-"));
  const ruta = join(dir, "Liquidacion_2026-08 (1).xlsx");
  await writeFile(ruta, XLSX.write(libro, { type: "buffer", bookType: "xlsx" }));
  return ruta;
}

const registro = {
  id: "reg-0209",
  fecha: "2026-09-02",
  horas: 8,
  proyecto: { codigo: "90001", nombre: "Reporte Contable - Inmobiliaria", inicio: "2026-09-01", fin: "2026-09-30" },
  colaborador: "Juan Pablo Pérez Reyes",
};

test("el Excel se convierte a texto con todas las hojas y sin suponer cabecera", async () => {
  const archivo = await extraer(await liquidacionSintetica());
  assert.equal(archivo.modo, "texto");
  assert.match(archivo.texto, /HOJA: Resumen empresa/);
  assert.match(archivo.texto, /Liquidación agosto 2026/);
  assert.match(archivo.texto, /Óscar Santos/);
});

test("liquidación de agosto como sustento de setiembre: autogenerado, periodo distinto, proyecto ausente", async () => {
  const archivo = await extraer(await liquidacionSintetica());
  const codigos = evaluarReglas({ registro, archivo }).map((a) => a.codigo);
  assert.ok(codigos.includes("AUTOGENERADO"));
  assert.ok(codigos.includes("PERIODO_DISTINTO"));
  assert.ok(codigos.includes("PROYECTO_AUSENTE"));
});

test("el mismo hash en otro registro marca evidencia duplicada", async () => {
  const archivo = await extraer(await liquidacionSintetica());
  const alertas = evaluarReglas({
    registro,
    archivo,
    otrosHashes: [{ registroId: "reg-0909", hash: archivo.hash }],
  });
  assert.ok(alertas.some((a) => a.codigo === "EVIDENCIA_DUPLICADA"));
});

test("hash guardado distinto al recalculado es crítico", async () => {
  const archivo = await extraer(await liquidacionSintetica());
  const alertas = evaluarReglas({ registro: { ...registro, hashGuardado: "0".repeat(64) }, archivo });
  assert.equal(alertas.find((a) => a.codigo === "HASH_ALTERADO")?.severidad, "critica");
});

test("periodosEnTexto reconoce ISO, dd/mm/aaaa y mes en letras", () => {
  const p = periodosEnTexto("Reunión 02/09/2026, cierre agosto 2026 y 2026-07-15");
  assert.deepEqual([...p].sort(), ["2026-07", "2026-08", "2026-09"]);
});
