import { analizarRegistro } from "./analizar.mjs";
import { extraer } from "./extraer.mjs";
import { consultarOpenAIResumen } from "./openai.mjs";
import { construirHtmlLote, veredictoGlobalDe } from "./informe.mjs";

const sinTildesLote = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Pipeline del informe consolidado de envío (lo mismo que `cli.mjs --lote
 * --lote-sin-pdf`), pero como función importable: la usa la plataforma (server
 * fn en src/lib/analizar.ts) cuando corre en Vercel, donde no hay CLI que
 * lanzar ni public/ escribible. Recibe los casos con las rutas absolutas de
 * la evidencia ya descargada y devuelve el HTML del informe más su entrada
 * del manifest; quien llama decide dónde publicarlos.
 */
export async function analizarEnvioLote({ colaborador, fecha, casos, modelo }) {
  // Huellas de contenido: detectan la misma evidencia reutilizada entre registros.
  const cargados = await Promise.all(
    casos.map(async ({ registro, rutas }) => {
      const huellas = await Promise.all(
        rutas.map((r) =>
          extraer(r).then((e) => ({ registroId: registro.id, hash: e.hash, huellaContenido: e.huellaContenido })),
        ),
      );
      return { registro, rutas, huellas };
    }),
  );

  // Análisis (reglas + IA) en paralelo: el envío tarda lo que tarda el más lento.
  const analisis = await Promise.all(
    cargados.map(({ registro, rutas, huellas }) => {
      const otrosHashes = cargados.filter((c) => c.registro !== registro).flatMap((c) => c.huellas);
      return analizarRegistro({ registro, rutas, otrosHashes, modelo });
    }),
  );
  const resultados = analisis.map((r, i) => ({ ...r, registro: cargados[i].registro }));

  // Resumen ejecutivo + acción recomendada (1 llamada extra a la IA). Si falla,
  // construirHtmlLote cae al resumen determinista.
  let resumen = null;
  if (resultados.some((r) => r.ia)) {
    try {
      resumen = await consultarOpenAIResumen({ colaborador, fecha, resultados, modelo });
    } catch {
      resumen = null;
    }
  }

  const html = construirHtmlLote({ colaborador, fecha, resultados, resumen });
  const slug =
    sinTildesLote(colaborador).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "colaborador";
  const nombreHtml = `informe-envio-${slug}-${fecha}.html`;
  const global = veredictoGlobalDe(resultados);
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
    archivo: nombreHtml.replace(/\.html$/, ".pdf"),
    htmlArchivo: nombreHtml,
    veredicto: global.veredicto,
    aprobado: false,
  };

  const lineas = resultados.map(
    (r) => `${r.veredicto.toUpperCase()} · ${r.registro.id} · ${r.registro.fecha} · ${r.registro.horas} h`,
  );
  if (resumen) lineas.push(`Resumen: ${resumen.resumen}`);
  return { html, nombreHtml, entrada, salida: lineas.join("\n") };
}
