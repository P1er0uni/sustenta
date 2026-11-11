import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analizarRegistro } from "./analizar.mjs";
import { extraer } from "./extraer.mjs";
import { generarInforme, generarInformeLote } from "./informe.mjs";
import { consultarOpenAIResumen } from "./openai.mjs";

const USO = `Uso: npm run analizar -- <caso.json> [<caso2.json> ...] [--sin-ia] [--sin-pdf] [--lote] [--lote-sin-pdf] [--modelo <id>]

Cada caso.json: { "registro": { id, fecha, horas, colaborador, actividad, descripcion, empresaReceptora,
                  proyecto: { codigo, nombre, descripcion, inicio, fin } },
                  "archivos": ["ruta/relativa/al/caso.xlsx"] }
Si pasas varios casos, el agente también detecta la misma evidencia reutilizada entre ellos.
Con --lote genera un único informe consolidado del envío (sin informes individuales).
Con --lote-sin-pdf publica el informe del envío como HTML + manifest sin renderizar el PDF
(la plataforma lo genera al aprobar, desde el HTML editado).`;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const casos = args.filter((a, i) => a.endsWith(".json") && args[i - 1] !== "--modelo");
if (casos.length === 0) {
  console.log(USO);
  process.exit(1);
}

const ICONO = { sustenta: "✅", sustenta_parcial: "🟡", no_sustenta: "⛔", ilegible: "❓", sin_analisis_ia: "⚙️" };
const linea = (t = "") => console.log(t);

const cargados = await Promise.all(
  casos.map(async (rutaCaso) => {
    const abs = resolve(rutaCaso);
    const caso = JSON.parse(await readFile(abs, "utf8"));
    const rutas = caso.archivos.map((a) => resolve(dirname(abs), a));
    const huellas = await Promise.all(
      rutas.map(async (r) => {
        const e = await extraer(r);
        return { registroId: caso.registro.id, hash: e.hash, huellaContenido: e.huellaContenido };
      }),
    );
    return { caso, rutas, huellas };
  }),
);

// Los análisis (reglas + IA) corren en paralelo: con N registros el envío
// tarda lo que tarda el más lento, no la suma de todos.
const analisis = await Promise.all(
  cargados.map(({ caso, rutas }) => {
    const otrosHashes = cargados.filter((c) => c.caso !== caso).flatMap((c) => c.huellas);
    return analizarRegistro({
      registro: caso.registro,
      rutas,
      otrosHashes,
      modelo: valor("--modelo"),
      sinIA: flag("--sin-ia"),
    });
  }),
);
const resultados = analisis.map((r, i) => ({ ...r, registro: cargados[i].caso.registro }));

for (const [i, r] of resultados.entries()) {
  const { caso } = cargados[i];

  linea(`\n${"═".repeat(78)}`);
  linea(`${ICONO[r.veredicto] ?? "•"}  ${caso.registro.id} · ${caso.registro.colaborador} · ${caso.registro.fecha} · ${caso.registro.horas} h`);
  linea(`   VEREDICTO: ${r.veredicto.toUpperCase()}${r.ia ? `  (confianza ${r.ia.confianza}; ${r.ia.traza.modelo})` : ""}`);
  linea(`   Archivos: ${r.archivos.map((a) => a.nombre.replace(/^[0-9a-f-]{36}-/, "")).join(", ")}`);
  if (r.ia) {
    linea(`\n   ${r.ia.resumen}`);
    linea(`   Tipo de documento: ${r.ia.tipo_documento}`);
    linea("\n   Comprobaciones:");
    for (const [k, v] of Object.entries(r.ia.comprobaciones)) linea(`     · ${k.padEnd(18)} ${v.resultado.padEnd(15)} ${v.explicacion}`);
    if (r.ia.citas.length) {
      linea("\n   Citas (verificadas contra el documento):");
      for (const c of r.ia.citas) linea(`     “${c.texto}”  [${c.verificada}] → ${c.sirve_para}`);
    }
    if (r.ia.alertas.length) {
      linea("\n   Alertas de la IA:");
      for (const a of r.ia.alertas) linea(`     ! ${a.codigo}: ${a.detalle}`);
    }
    if (r.ia.evidencia_faltante) linea(`\n   Evidencia que sí sustentaría: ${r.ia.evidencia_faltante}`);
  }
  if (r.reglas.length) {
    linea("\n   Reglas deterministas:");
    for (const a of r.reglas) linea(`     [${a.severidad}] ${a.codigo} (${a.archivo.replace(/^[0-9a-f-]{36}-/, "")}): ${a.detalle}`);
  }
}

const carpeta = fileURLToPath(new URL("../resultados/", import.meta.url));
await mkdir(carpeta, { recursive: true });
const salida = `${carpeta}analisis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(salida, JSON.stringify(resultados, null, 2), "utf8");
linea(`\nResultado guardado en ${salida}`);

if (!flag("--sin-pdf")) {
  const informes = fileURLToPath(new URL("../informes/", import.meta.url));

  if (flag("--lote")) {
    // Informe consolidado del envío: un solo documento para la jefatura.
    // La unidad del envío es el DÍA de trabajo (un informe por colaborador+día).
    const colaborador = cargados[0]?.caso.registro.colaborador ?? "Colaborador";
    const fecha = cargados[0]?.caso.registro.fecha ?? "";
    let resumen = null;
    if (!flag("--sin-ia") && resultados.some((r) => r.ia)) {
      try {
        resumen = await consultarOpenAIResumen({ colaborador, fecha, resultados, modelo: valor("--modelo") });
        linea(`\nResumen ejecutivo: ${resumen.resumen}`);
        linea(`Recomendación (${resumen.accion}): ${resumen.recomendacion}`);
      } catch (e) {
        linea(`\n(Sin resumen de IA: ${e.message})`);
      }
    }
    const out = await generarInformeLote({
      colaborador,
      fecha,
      resultados,
      resumen,
      carpeta: informes,
      sinPdf: flag("--lote-sin-pdf"),
    });
    linea(
      out.pdf
        ? `Informe del envío: ${out.pdf}${out.paginas ? ` (${out.paginas} pág., fuente ${out.tamanoFuente}px)` : ""}`
        : `Informe del envío (HTML): ${out.html}${out.motivo ? `\n   ${out.motivo}` : ""}`,
    );
  } else {
    for (const { registro, ...resultado } of resultados) {
      const out = await generarInforme({ registro, resultado, carpeta: informes });
      linea(out.pdf ? `Informe PDF: ${out.pdf}${out.paginas ? ` (${out.paginas} pág., fuente ${out.tamanoFuente}px)` : ""}` : `Informe HTML (sin PDF): ${out.html}\n   ${out.motivo}`);
    }
  }
}
