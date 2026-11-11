import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extraer } from "../src/extraer.mjs";
import { evaluarReglas } from "../src/reglas.mjs";

const DIR = new URL("../casos/", import.meta.url);
const archivos = existsSync(DIR) ? readdirSync(DIR).filter((f) => /Liquidacion_2026-08 \([12]\)\.xlsx$/.test(f)) : [];

const proyecto = { codigo: "90001", nombre: "Reporte Contable - Inmobiliaria", inicio: "2026-09-01", fin: "2026-09-30" };
const registros = [
  { id: "reg-0209", fecha: "2026-09-02", horas: 8, proyecto, colaborador: "Juan Pablo Pérez Reyes" },
  { id: "reg-0909", fecha: "2026-09-09", horas: 8, proyecto, colaborador: "Juan Pablo Pérez Reyes" },
];

test("casos reales: las dos liquidaciones de agosto no sustentan los registros de setiembre", { skip: archivos.length !== 2 }, async () => {
  const extraidos = await Promise.all(archivos.map((f) => extraer(fileURLToPath(new URL(f, DIR)))));
  extraidos.forEach((a, i) => {
    const otros = extraidos.filter((_, j) => j !== i).map((o) => ({ ...o, registroId: registros[1 - i].id }));
    const codigos = evaluarReglas({ registro: registros[i], archivo: a, otrosHashes: otros }).map((x) => x.codigo);
    for (const esperado of ["AUTOGENERADO", "PERIODO_DISTINTO", "PROYECTO_AUSENTE", "CONTENIDO_DUPLICADO"]) {
      assert.ok(codigos.includes(esperado), `${a.nombre}: falta ${esperado}; hay ${codigos}`);
    }
  });
});
