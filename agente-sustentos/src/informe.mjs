import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─── Limitación de páginas ───────────────────────────────────────────────────
const MAX_PAGINAS = 2;
const FUENTE_INICIAL = 10.5;
const FUENTE_MINIMA = 7;
const FUENTE_PASO = 0.5;

/**
 * Cuenta las páginas de un PDF leyendo el binario.
 * Busca entradas /Type /Page (no /Pages) en el contenido del PDF.
 */
function contarPaginasPdf(rutaPdf) {
  try {
    const buffer = readFileSync(rutaPdf);
    const texto = buffer.toString("latin1");
    // Método 1: /Count N en el nodo /Pages raíz (más fiable)
    const countMatch = /\/Type\s*\/Pages\b[^>]*\/Count\s+(\d+)/.exec(texto);
    if (countMatch) return parseInt(countMatch[1], 10);
    // Método 2: contar /Type /Page (no /Pages) individuales
    let count = 0;
    const regex = /\/Type\s*\/Page\b(?!s)/g;
    while (regex.exec(texto) !== null) count++;
    return Math.max(1, count);
  } catch {
    return 1;
  }
}

const NAVEGADORES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

// Tokens de la identidad visual de Sustenta (README).
const VEREDICTOS = {
  sustenta: { etiqueta: "SUSTENTA", color: "#0F6E56", fondo: "#E4F2EE" },
  sustenta_parcial: { etiqueta: "SUSTENTA PARCIALMENTE", color: "#A9670C", fondo: "#FBF0DC" },
  no_sustenta: { etiqueta: "NO SUSTENTA", color: "#DF3E3F", fondo: "#FCEAEA" },
  ilegible: { etiqueta: "ILEGIBLE", color: "#61656E", fondo: "#ECEBE8" },
  sin_analisis_ia: { etiqueta: "SIN ANÁLISIS DE IA", color: "#61656E", fondo: "#ECEBE8" },
};
const RESULTADO = {
  coincide: { t: "Coincide", c: "#0F6E56", f: "#E4F2EE" },
  no_coincide: { t: "No coincide", c: "#DF3E3F", f: "#FCEAEA" },
  no_verificable: { t: "No verificable", c: "#A9670C", f: "#FBF0DC" },
};
const SEVERIDAD = {
  critica: { c: "#DF3E3F", f: "#FCEAEA" },
  alta: { c: "#DF3E3F", f: "#FCEAEA" },
  media: { c: "#A9670C", f: "#FBF0DC" },
  baja: { c: "#61656E", f: "#ECEBE8" },
};
const ETIQUETA_COMPROBACION = {
  fecha: "Fecha",
  colaborador: "Colaborador",
  proyecto_o_empresa: "Proyecto / empresa",
  actividad: "Actividad",
  horas: "Horas",
};

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sinUuid = (n) => n.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Opciones cerradas que el editor de la plataforma ofrece como menú (no edición libre).
const OPCIONES_VEREDICTO = ["sustenta", "sustenta_parcial", "no_sustenta", "ilegible"].map((k) => ({
  t: VEREDICTOS[k].etiqueta, c: VEREDICTOS[k].color, f: VEREDICTOS[k].fondo,
}));
const OPCIONES_RESULTADO = Object.values(RESULTADO).map(({ t, c, f }) => ({ t, c, f }));
const OPCIONES_SEVERIDAD = Object.entries(SEVERIDAD).map(([t, { c, f }]) => ({ t, c, f }));

const attrOpciones = (lista) => ` data-opciones="${esc(JSON.stringify(lista))}"`;
const badge = (texto, { c, f }, opciones) =>
  `<span class="badge" style="color:${c};background:${f}"${opciones ? attrOpciones(opciones) : ""}>${esc(texto)}</span>`;

// Acción recomendada a la jefatura sobre el envío completo.
const ACCION = {
  aprobar: { t: "Aprobar el envío", c: "#0F6E56", f: "#E4F2EE" },
  aprobar_con_observaciones: { t: "Aprobar con observaciones", c: "#A9670C", f: "#FBF0DC" },
  rechazar: { t: "Rechazar el envío", c: "#DF3E3F", f: "#FCEAEA" },
};
const OPCIONES_ACCION = Object.values(ACCION).map(({ t, c, f }) => ({ t, c, f }));

// CSS compartido entre el informe individual y el de envío (identidad visual Sustenta).
// tamanoFuente escala todo el texto: se reduce cuando el contenido excede MAX_PAGINAS.
const cssBase = (tamanoFuente = FUENTE_INICIAL) => {
  const escala = tamanoFuente / FUENTE_INICIAL;
  const px = (v) => `${(v * escala).toFixed(2)}px`;
  return `
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: ${px(10.5)}/1.5 "Segoe UI", Arial, sans-serif; color: #1B1E24; }
  h1 { font-size: ${px(17)}; margin: 0; }
  h2 { font-size: ${px(11)}; text-transform: uppercase; letter-spacing: .06em; color: #61656E; margin: ${(18 * escala).toFixed(2)}px 0 ${(6 * escala).toFixed(2)}px; border-bottom: 1px solid #E4E2DE; padding-bottom: 3px; }
  h3 { font-size: ${px(12)}; margin: ${(14 * escala).toFixed(2)}px 0 ${(4 * escala).toFixed(2)}px; }
  .num, .mono { font-family: Consolas, "Courier New", monospace; font-variant-numeric: tabular-nums; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #DF3E3F; padding-bottom: 8px; }
  header small { color: #61656E; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: ${(4 * escala).toFixed(2)}px ${(6 * escala).toFixed(2)}px; border-bottom: 1px solid #E4E2DE; }
  th { font-size: ${px(9.5)}; color: #61656E; font-weight: 600; width: 22%; }
  table.cols th { width: auto; text-transform: uppercase; letter-spacing: .04em; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: ${px(9.5)}; font-weight: 700; white-space: nowrap; }
  blockquote { margin: ${(4 * escala).toFixed(2)}px 0; padding: ${(5 * escala).toFixed(2)}px ${(9 * escala).toFixed(2)}px; border-left: 3px solid #E4E2DE; background: #F6F5F3; }
  blockquote small { display: block; color: #61656E; margin-top: 2px; }
  .aviso { margin-top: ${(18 * escala).toFixed(2)}px; padding: ${(8 * escala).toFixed(2)}px ${(10 * escala).toFixed(2)}px; background: #F6F5F3; border: 1px solid #E4E2DE; border-radius: 6px; color: #61656E; }
  footer { margin-top: ${(14 * escala).toFixed(2)}px; color: #61656E; font-size: ${px(9)}; border-top: 1px solid #E4E2DE; padding-top: 6px; }
  tr, blockquote { break-inside: avoid; }
`;
};
// La caja de veredicto toma el color del veredicto, así que va por informe.
const cssVeredicto = (color, fondo) => `
  .veredicto { margin-top: 12px; padding: 12px 14px; border-radius: 8px; border: 1px solid ${color}; background: ${fondo}; }
  .veredicto b { font-size: 18px; color: ${color}; letter-spacing: .02em; }
  .veredicto span { color: #61656E; margin-left: 8px; }
  .veredicto p { margin: 6px 0 0; }
  .veredicto { break-inside: avoid; }
`;

const ORDEN_GLOBAL = { sustenta: 0, sustenta_parcial: 1, ilegible: 2, no_sustenta: 3 };
const peorDe = (a, b) => ((ORDEN_GLOBAL[a] ?? 3) >= (ORDEN_GLOBAL[b] ?? 3) ? a : b);

/**
 * Veredicto global de un envío: el peor de los registros individuales.
 * Los registros sin análisis de IA (sin evidencia) no dan por sustentado el envío:
 * degradan el global a sustenta_parcial como mínimo.
 */
export function veredictoGlobalDe(resultados) {
  const total = resultados.length;
  const sustentan = resultados.filter((r) => r.veredicto === "sustenta").length;
  const sinAnalisis = resultados.filter((r) => r.veredicto === "sin_analisis_ia").length;
  const evaluados = resultados.filter((r) => r.veredicto !== "sin_analisis_ia");
  let veredicto;
  if (evaluados.length === 0) veredicto = "sin_analisis_ia";
  else {
    veredicto = evaluados.reduce((peor, r) => peorDe(peor, r.veredicto), "sustenta");
    if (sinAnalisis > 0) veredicto = peorDe(veredicto, "sustenta_parcial");
  }
  return { veredicto, total, sustentan, sinAnalisis };
}

/** Resumen y recomendación deterministas, para cuando no hay IA disponible. */
function resumenDeterminista(global, alertasTotales) {
  const partes = [`${global.sustentan} de ${global.total} registros sustentan sus horas con evidencia`];
  if (global.sinAnalisis) partes.push(`${global.sinAnalisis} sin evidencia adjunta`);
  if (alertasTotales) partes.push(`${alertasTotales} alerta(s) en el envío`);
  const resumen = `${partes.join("; ")}.`;
  const accion =
    global.veredicto === "sustenta" && alertasTotales === 0
      ? "aprobar"
      : global.veredicto === "no_sustenta"
        ? "rechazar"
        : "aprobar_con_observaciones";
  return { resumen, recomendacion: "Revisa las alertas del envío antes de resolver.", accion };
}

export function construirHtml({ registro, resultado, tamanoFuente = FUENTE_INICIAL }) {
  const v = VEREDICTOS[resultado.veredicto] ?? VEREDICTOS.sin_analisis_ia;
  const ia = resultado.ia;
  const p = registro.proyecto ?? {};
  const alertas = [
    ...resultado.reglas.map((a) => ({ origen: "Regla", ...a })),
    ...(ia?.alertas ?? []).map((a) => ({ origen: "IA", severidad: "media", ...a })),
  ];
  const generado = new Date().toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" });

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de análisis de sustento · ${esc(registro.id)}</title>
<style>${cssBase(tamanoFuente)}${cssVeredicto(v.color, v.fondo)}</style></head><body>
<header>
  <div><h1>Informe de análisis de sustento</h1><small>Sustenta · agente de revisión de evidencias</small></div>
  <small>${esc(generado)}</small>
</header>

<div class="veredicto">
  <b${attrOpciones(OPCIONES_VEREDICTO)}>${v.etiqueta}</b>${ia ? `<span>Confianza ${esc(ia.confianza)}</span>` : ""}
  ${ia ? `<p>${esc(ia.resumen)}</p>` : `<p>Solo se aplicaron reglas deterministas; no se consultó a la IA.</p>`}
</div>

${ia?.resumen_evidencia ? `<h2>Resumen de la evidencia</h2>
<div style="padding:10px 14px;background:#F6F5F3;border:1px solid #E4E2DE;border-radius:6px;white-space:pre-line">${esc(ia.resumen_evidencia)}</div>` : ""}

<h2>Registro de horas analizado</h2>
<table>
  <tr><th>Registro</th><td class="mono">${esc(registro.id)}</td></tr>
  <tr><th>Colaborador</th><td>${esc(registro.colaborador)}</td></tr>
  <tr><th>Fecha · Horas</th><td class="num">${esc(registro.fecha)} · ${esc(registro.horas)} h</td></tr>
  <tr><th>Proyecto</th><td><span class="num">${esc(p.codigo)}</span> · ${esc(p.nombre)}${p.descripcion ? `<br><small>${esc(p.descripcion)}</small>` : ""}</td></tr>
  <tr><th>Empresa receptora</th><td>${esc(registro.empresaReceptora ?? "—")}</td></tr>
  <tr><th>Actividad declarada</th><td>${esc(registro.actividad ?? "—")}</td></tr>
  <tr><th>Descripción</th><td>${esc(registro.descripcion ?? "—")}</td></tr>
</table>

<h2>Archivos de sustento revisados</h2>
<table class="cols"><tr><th>Archivo</th><th>Tamaño</th><th>SHA-256</th></tr>
${resultado.archivos
  .map((a) => `<tr><td>${esc(sinUuid(a.nombre))}</td><td class="num">${esc(kb(a.bytes))}</td><td class="mono" style="font-size:8.5px;word-break:break-all">${esc(a.hash)}</td></tr>`)
  .join("")}
</table>
${ia ? `<p><small>Tipo de documento detectado: ${esc(ia.tipo_documento)}</small></p>` : ""}

${ia ? `<h2>Comprobaciones contra el registro</h2>
<table class="cols"><tr><th>Aspecto</th><th>Resultado</th><th>Explicación</th></tr>
${Object.entries(ia.comprobaciones)
  .map(([k, c]) => `<tr><td>${esc(ETIQUETA_COMPROBACION[k] ?? k)}</td><td>${badge(RESULTADO[c.resultado]?.t ?? c.resultado, RESULTADO[c.resultado] ?? SEVERIDAD.baja, OPCIONES_RESULTADO)}</td><td>${esc(c.explicacion)}</td></tr>`)
  .join("")}
</table>` : ""}

${ia?.citas?.length ? `<h2>Citas textuales del documento</h2>
${ia.citas.map((c) => `<blockquote>“${esc(c.texto)}”<small>${esc(sinUuid(c.archivo))} · ${c.verificada === "literal" ? "verificada literalmente en el documento" : esc(c.verificada)} — ${esc(c.sirve_para)}</small></blockquote>`).join("")}` : ""}

${alertas.length ? `<h2>Alertas</h2>
<table class="cols"><tr><th style="width:11%">Origen</th><th style="width:16%">Severidad</th><th>Detalle</th></tr>
${alertas.map((a) => `<tr><td>${esc(a.origen)}</td><td>${badge(a.severidad, SEVERIDAD[a.severidad] ?? SEVERIDAD.baja, OPCIONES_SEVERIDAD)}</td><td><b class="mono" style="font-size:9px">${esc(a.codigo)}</b><br>${esc(a.detalle)}</td></tr>`).join("")}
</table>` : ""}

${ia?.evidencia_faltante ? `<h2>Evidencia que sí sustentaría</h2><p>${esc(ia.evidencia_faltante)}</p>` : ""}

<div class="aviso">Análisis consultivo generado automáticamente. No aprueba ni rechaza registros, y no reemplaza la revisión de la jefatura
ni el expediente de defensa sellado de Sustenta.</div>
<footer data-pie="1">
  Generado ${esc(generado)}
</footer>
</body></html>`;
}

function buscarNavegador() {
  return NAVEGADORES.find((n) => existsSync(n)) ?? null;
}

function htmlAPdf(navegador, rutaHtml, rutaPdf, perfil) {
  return new Promise((resolver, rechazar) => {
    execFile(
      navegador,
      [
        "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${perfil}`,
        `--print-to-pdf=${rutaPdf}`, pathToFileURL(rutaHtml).href,
      ],
      { timeout: 60000, windowsHide: true },
      (error) => (error ? rechazar(error) : resolver()),
    );
  });
}

/**
 * Demo: si el agente vive dentro de la réplica de la app (existe ../../public), copia el PDF a
 * public/informes y actualiza manifest.json para que Aprobaciones muestre el botón "Informe IA".
 * Fuera de la réplica (p. ej. un zip aparte) no hace nada.
 */
async function publicarEnPlataforma({ registro, resultado, pdf, html }) {
  const publico = fileURLToPath(new URL("../../public/", import.meta.url));
  if (!existsSync(publico)) return false;
  const destino = join(publico, "informes");
  await mkdir(destino, { recursive: true });
  const archivo = basename(pdf);
  await copyFile(pdf, join(destino, archivo));

  // Publicar también el HTML para que la página de edición pueda cargarlo
  const htmlArchivo = basename(html);
  await copyFile(html, join(destino, htmlArchivo));

  const rutaManifest = join(destino, "manifest.json");
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(rutaManifest, "utf8"));
  } catch {
    // sin manifest previo: se crea uno nuevo
  }
  const entrada = {
    proyecto: registro.proyecto?.codigo ?? "",
    fecha: registro.fecha,
    colaborador: registro.colaborador,
    archivo,
    htmlArchivo,
    veredicto: resultado.veredicto,
    aprobado: false,
  };
  const otros = manifest.filter((m) => m.archivo !== archivo);
  await writeFile(rutaManifest, JSON.stringify([...otros, entrada], null, 2), "utf8");
  return true;
}

/**
 * Genera el informe de un análisis. Devuelve { pdf } o, si no hay navegador / falla la
 * conversión, { html, motivo } dejando el HTML para abrirlo e imprimir a PDF a mano.
 * Limita el PDF a MAX_PAGINAS: si excede, reduce la fuente y regenera hasta que quepa.
 */
export async function generarInforme({ registro, resultado, carpeta }) {
  await mkdir(carpeta, { recursive: true });
  const base = join(carpeta, `informe-${registro.id}`);
  const rutaHtml = `${base}.html`;
  const rutaPdf = `${base}.pdf`;

  const navegador = buscarNavegador();
  if (!navegador) {
    await writeFile(rutaHtml, construirHtml({ registro, resultado }), "utf8");
    return { html: rutaHtml, motivo: "No se encontró Edge ni Chrome para convertir a PDF." };
  }

  let tamanoFuente = FUENTE_INICIAL;
  let paginas = Infinity;
  const perfil = await mkdtemp(join(tmpdir(), "informe-perfil-"));
  try {
    while (tamanoFuente >= FUENTE_MINIMA) {
      await writeFile(rutaHtml, construirHtml({ registro, resultado, tamanoFuente }), "utf8");
      await htmlAPdf(navegador, rutaHtml, rutaPdf, perfil);
      if (!existsSync(rutaPdf)) throw new Error("El navegador terminó sin generar el PDF.");
      paginas = contarPaginasPdf(rutaPdf);
      if (paginas <= MAX_PAGINAS) break;
      tamanoFuente -= FUENTE_PASO;
    }
    const publicado = await publicarEnPlataforma({ registro, resultado, pdf: rutaPdf, html: rutaHtml }).catch(() => false);
    return { pdf: rutaPdf, html: rutaHtml, publicado, paginas, tamanoFuente };
  } catch (e) {
    return { html: rutaHtml, motivo: `Falló la conversión a PDF: ${e.message}` };
  } finally {
    await rm(perfil, { recursive: true, force: true });
  }
}

/**
 * HTML del informe consolidado de un envío (varios registros del mismo colaborador).
 * Mismo diseño que el individual: veredicto global arriba, resumen del envío,
 * detalle por registro y alertas consolidadas. Pensado para que la jefatura lea
 * un solo documento en lugar de revisar registro por registro.
 */
export function construirHtmlLote({ colaborador, fecha, resultados, resumen, contexto, tamanoFuente = FUENTE_INICIAL }) {
  const global = veredictoGlobalDe(resultados);
  const v = VEREDICTOS[global.veredicto] ?? VEREDICTOS.sin_analisis_ia;
  const alertasTodas = resultados.flatMap((r) => [
    ...r.reglas.map((a) => ({ registro: r.registro, origen: "Regla", severidad: "media", ...a })),
    ...(r.ia?.alertas ?? []).map((a) => ({ registro: r.registro, origen: "IA", severidad: "media", ...a })),
  ]);
  const res = resumen?.resumen ? resumen : resumenDeterminista(global, alertasTodas.length);
  const accion = ACCION[res.accion] ?? ACCION.aprobar_con_observaciones;
  const totalHoras = resultados.reduce((s, r) => s + Number(r.registro.horas ?? 0), 0);
  const generado = new Date().toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" });

  // RAG (spec 002): fragmentos de informes anteriores que informaron el resumen.
  // Trazabilidad — mismo espíritu que las citas verificadas: se muestra qué se consultó.
  const contextoHtml = Array.isArray(contexto) && contexto.length
    ? `<h2>Contexto consultado (base de conocimiento)</h2>
<p><small>Fragmentos de informes anteriores recuperados por similitud semántica para informar el resumen ejecutivo. No son evidencia de este envío.</small></p>
<table class="cols"><tr><th>Informe</th><th>Colaborador</th><th>Fecha</th><th>Fragmento</th><th style="width:9%">Similitud</th></tr>
${contexto
  .map((c) => {
    const texto = String(c.texto ?? "");
    return `<tr><td>${esc(sinUuid(c.fuente ?? ""))}</td><td>${esc(c.colaborador ?? "")}</td><td class="num">${esc(c.fecha ?? "")}</td><td>${esc(texto.slice(0, 220))}${texto.length > 220 ? "…" : ""}</td><td class="num">${Math.round((Number(c.similitud) || 0) * 100)}%</td></tr>`;
  })
  .join("\n")}
</table>`
    : "";

  const filaResumen = (r) => {
    const rv = VEREDICTOS[r.veredicto] ?? VEREDICTOS.sin_analisis_ia;
    const p = r.registro.proyecto ?? {};
    return `<tr>
  <td class="num">${esc(r.registro.fecha)}</td>
  <td><span class="num">${esc(p.codigo ?? "—")}</span> · ${esc(p.nombre ?? "")}</td>
  <td>${esc(r.registro.actividad ?? "—")}</td>
  <td class="num">${esc(r.registro.horas)} h</td>
  <td>${r.archivos.length ? `${r.archivos.length} archivo(s)` : '<b style="color:#A9670C">Sin evidencia</b>'}</td>
  <td>${badge(rv.etiqueta, { c: rv.color, f: rv.fondo }, OPCIONES_VEREDICTO)}</td>
</tr>`;
  };

  const detalleRegistro = (r) => {
    const rv = VEREDICTOS[r.veredicto] ?? VEREDICTOS.sin_analisis_ia;
    const reg = r.registro;
    const p = reg.proyecto ?? {};
    return `<h3><span class="num">${esc(reg.fecha)}</span> · <span class="num">${esc(p.codigo ?? "—")}</span> · ${esc(reg.horas)} h
  ${badge(rv.etiqueta, { c: rv.color, f: rv.fondo }, OPCIONES_VEREDICTO)}</h3>
${r.ia?.resumen_evidencia ? `<div style="padding:8px 12px;background:#F6F5F3;border:1px solid #E4E2DE;border-radius:6px;margin:4px 0 8px;white-space:pre-line">${esc(r.ia.resumen_evidencia)}</div>` : ""}
<table>
  <tr><th>Registro</th><td class="mono">${esc(reg.id)}</td></tr>
  <tr><th>Actividad declarada</th><td>${esc(reg.actividad ?? "—")}</td></tr>
  <tr><th>Descripción</th><td>${esc(reg.descripcion ?? "—")}</td></tr>
  <tr><th>Empresa receptora</th><td>${esc(reg.empresaReceptora ?? "—")}</td></tr>
  <tr><th>Evidencia adjunta</th><td>${
    r.archivos.length
      ? r.archivos.map((a) => `${esc(sinUuid(a.nombre))} <small>(${esc(kb(a.bytes))}, SHA-256 <span class="mono" style="font-size:8px;word-break:break-all">${esc(a.hash)}</span>)</small>`).join("<br>")
      : '<b style="color:#A9670C">Sin archivo adjunto</b>'
  }</td></tr>
</table>
${r.ia ? `<table class="cols"><tr><th>Aspecto</th><th>Resultado</th><th>Explicación</th></tr>
${Object.entries(r.ia.comprobaciones)
  .map(([k, c]) => `<tr><td>${esc(ETIQUETA_COMPROBACION[k] ?? k)}</td><td>${badge(RESULTADO[c.resultado]?.t ?? c.resultado, RESULTADO[c.resultado] ?? SEVERIDAD.baja, OPCIONES_RESULTADO)}</td><td>${esc(c.explicacion)}</td></tr>`)
  .join("")}
</table>` : `<p><small>Sin análisis de IA: el registro no trajo evidencia adjunta o se analizó solo con reglas.</small></p>`}
${r.ia?.citas?.length ? r.ia.citas.map((c) => `<blockquote>“${esc(c.texto)}”<small>${esc(sinUuid(c.archivo))} · ${c.verificada === "literal" ? "verificada literalmente en el documento" : esc(c.verificada)} — ${esc(c.sirve_para)}</small></blockquote>`).join("") : ""}`;
  };

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de análisis de sustento · Envío de ${esc(colaborador)} · ${esc(fecha)}</title>
<style>${cssBase(tamanoFuente)}${cssVeredicto(v.color, v.fondo)}</style></head><body>
<header>
  <div><h1>Informe de análisis de sustento — envío</h1><small>Sustenta · agente de revisión de evidencias</small></div>
  <small>${esc(generado)}</small>
</header>

<div class="veredicto">
  <b${attrOpciones(OPCIONES_VEREDICTO)}>${v.etiqueta}</b><span><span class="num">${global.sustentan}</span> de <span class="num">${global.total}</span> registros sustentan${global.sinAnalisis ? ` · ${global.sinAnalisis} sin evidencia` : ""}</span>
  <p>${esc(res.resumen)}</p>
</div>

<div style="margin-top:10px;padding:10px 14px;border-radius:8px;border:1px solid ${accion.c};background:${accion.f};break-inside:avoid">
  <b style="color:${accion.c}"${attrOpciones(OPCIONES_ACCION)}>${accion.t}</b>
  <p style="margin:6px 0 0">${esc(res.recomendacion)}</p>
</div>

${contextoHtml}

<h2>Envío revisado</h2>
<table>
  <tr><th>Colaborador</th><td>${esc(colaborador)}</td></tr>
  <tr><th>Fecha del envío</th><td class="num">${esc(fecha)}</td></tr>
  <tr><th>Registros · Horas</th><td class="num">${esc(global.total)} registros · ${esc(totalHoras)} h</td></tr>
</table>

<h2>Resumen del envío</h2>
<table class="cols"><tr><th>Fecha</th><th>Proyecto</th><th>Actividad</th><th>Horas</th><th>Evidencia</th><th>Veredicto</th></tr>
${resultados.map(filaResumen).join("\n")}
</table>

<h2>Detalle por registro</h2>
${resultados.map(detalleRegistro).join("\n")}

${alertasTodas.length ? `<h2>Alertas del envío</h2>
<table class="cols"><tr><th style="width:16%">Registro</th><th style="width:10%">Origen</th><th style="width:15%">Severidad</th><th>Detalle</th></tr>
${alertasTodas
  .map(
    (a) =>
      `<tr><td class="num">${esc(a.registro.fecha)} · ${esc(a.registro.proyecto?.codigo ?? "")}</td><td>${esc(a.origen)}</td><td>${badge(a.severidad, SEVERIDAD[a.severidad] ?? SEVERIDAD.baja, OPCIONES_SEVERIDAD)}</td><td><b class="mono" style="font-size:9px">${esc(a.codigo)}</b><br>${esc(a.detalle)}</td></tr>`,
  )
  .join("\n")}
</table>` : ""}

<div class="aviso">Análisis consultivo generado automáticamente. No aprueba ni rechaza registros, y no reemplaza la revisión de la jefatura
ni el expediente de defensa sellado de Sustenta.</div>
<footer data-pie="1">
  Generado ${esc(generado)}
</footer>
</body></html>`;
}

/**
 * Publica el informe de envío en la réplica de la app: copia PDF+HTML a public/informes
 * y registra una entrada tipo "lote" en manifest.json (una por colaborador+día de trabajo).
 */
async function publicarLoteEnPlataforma({ colaborador, fecha, resultados, veredicto, pdf, html }) {
  const publico = fileURLToPath(new URL("../../public/", import.meta.url));
  if (!existsSync(publico)) return false;
  const destino = join(publico, "informes");
  await mkdir(destino, { recursive: true });
  // Sin PDF (sinPdf): el nombre del PDF futuro se deriva del HTML; el archivo
  // lo escribe la plataforma al aprobar, renderizando el HTML ya editado.
  const archivo = pdf ? basename(pdf) : `${basename(html).replace(/\.html$/, "")}.pdf`;
  const htmlArchivo = basename(html);
  if (pdf) await copyFile(pdf, join(destino, archivo));
  await copyFile(html, join(destino, htmlArchivo));

  const rutaManifest = join(destino, "manifest.json");
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(rutaManifest, "utf8"));
  } catch {
    // sin manifest previo: se crea uno nuevo
  }
  const entrada = {
    tipo: "lote",
    colaborador,
    fecha,
    registros: resultados.map((r) => ({
      registroId: r.registro.id,
      fecha: r.registro.fecha,
      proyecto: r.registro.proyecto?.codigo ?? "",
      veredicto: r.veredicto,
      resumen_evidencia: r.ia?.resumen_evidencia ?? r.ia?.resumen ?? null,
    })),
    archivo,
    htmlArchivo,
    veredicto,
    aprobado: false,
  };
  // Una entrada por colaborador+día: al regenerar se reemplaza la anterior.
  // (Las entradas antiguas sin `fecha` —keyadas por periodo— se conservan.)
  const sinTildesLote = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const mismoColaborador = (a, b) => sinTildesLote(a).split(/\s+/).every((p) => sinTildesLote(b).includes(p));
  const otros = manifest.filter(
    (m) =>
      m.archivo !== archivo &&
      !(m.tipo === "lote" && m.fecha === fecha && mismoColaborador(m.colaborador, colaborador)),
  );
  await writeFile(rutaManifest, JSON.stringify([...otros, entrada], null, 2), "utf8");
  return true;
}

/**
 * Genera el informe consolidado del envío. Igual que generarInforme: devuelve { pdf }
 * o { html, motivo } si no hay navegador o falla la conversión.
 * Con sinPdf publica solo el HTML + manifest (la plataforma renderiza el PDF al
 * aprobar): evita lanzar Chrome para un PDF que luego se descarta al editar.
 */
export async function generarInformeLote({ colaborador, fecha, resultados, resumen, contexto, carpeta, sinPdf = false }) {
  await mkdir(carpeta, { recursive: true });
  const slug = String(colaborador)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = join(carpeta, `informe-envio-${slug || "colaborador"}-${fecha}`);
  const rutaHtml = `${base}.html`;
  const rutaPdf = `${base}.pdf`;
  await writeFile(rutaHtml, construirHtmlLote({ colaborador, fecha, resultados, resumen, contexto }), "utf8");

  if (sinPdf) {
    const global = veredictoGlobalDe(resultados);
    const publicado = await publicarLoteEnPlataforma({
      colaborador,
      fecha,
      resultados,
      veredicto: global.veredicto,
      pdf: null,
      html: rutaHtml,
    }).catch(() => false);
    return { html: rutaHtml, publicado };
  }

  const navegador = buscarNavegador();
  if (!navegador) return { html: rutaHtml, motivo: "No se encontró Edge ni Chrome para convertir a PDF." };

  let tamanoFuente = FUENTE_INICIAL;
  let paginas = Infinity;
  const perfil = await mkdtemp(join(tmpdir(), "informe-perfil-"));
  try {
    while (tamanoFuente >= FUENTE_MINIMA) {
      await writeFile(rutaHtml, construirHtmlLote({ colaborador, fecha, resultados, resumen, contexto, tamanoFuente }), "utf8");
      await htmlAPdf(navegador, rutaHtml, rutaPdf, perfil);
      if (!existsSync(rutaPdf)) throw new Error("El navegador terminó sin generar el PDF.");
      paginas = contarPaginasPdf(rutaPdf);
      if (paginas <= MAX_PAGINAS) break;
      tamanoFuente -= FUENTE_PASO;
    }
    const global = veredictoGlobalDe(resultados);
    const publicado = await publicarLoteEnPlataforma({
      colaborador,
      fecha,
      resultados,
      veredicto: global.veredicto,
      pdf: rutaPdf,
      html: rutaHtml,
    }).catch(() => false);
    return { pdf: rutaPdf, html: rutaHtml, publicado, paginas, tamanoFuente };
  } catch (e) {
    return { html: rutaHtml, motivo: `Falló la conversión a PDF: ${e.message}` };
  } finally {
    await rm(perfil, { recursive: true, force: true });
  }
}
