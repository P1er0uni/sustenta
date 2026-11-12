import { analizarRegistro } from "./analizar.mjs";
import { extraer } from "./extraer.mjs";
import { consultarAnalistaResumen } from "./analista.mjs";
import { construirHtmlLote, veredictoGlobalDe } from "./informe.mjs";
import { recuperarContextoEnvio } from "./rag.mjs";
import { avisosDeCambioDeModelo, limpiarCambiosDeModelo } from "./maas-llm.mjs";

const sinTildesLote = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Pipeline del informe consolidado de envío (lo mismo que `cli.mjs --lote
 * --lote-sin-pdf`), pero como función importable: la usa la plataforma (server
 * fn en src/lib/analizar.ts) cuando corre en Vercel, donde no hay CLI que
 * lanzar ni public/ escribible. Recibe los casos con las rutas absolutas de
 * la evidencia ya descargada y devuelve el HTML del informe más su entrada
 * del manifest; quien llama decide dónde publicarlos.
 *
 * `token` (opcional): access_token de Supabase del usuario. Con él, se recupera
 * el contexto RAG (informes anteriores) para el resumen ejecutivo; sin él o sin
 * MaaS configurado, el informe sale igual que sin RAG.
 */
export async function analizarEnvioLote({ colaborador, fecha, casos, modelo, token, contexto }) {
  // Bitácora de la corrida: en Vercel el módulo sobrevive entre invocaciones
  // del mismo lambda, así que los avisos de cambio de modelo (redundancia del
  // MaaS) se limpian al empezar cada envío.
  limpiarCambiosDeModelo();
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

  // RAG (spec 002): contexto de informes anteriores para el resumen ejecutivo.
  // recuperarContextoEnvio nunca lanza — sin token/MaaS/tabla devuelve [].
  const ctx = contexto ?? (token ? await recuperarContextoEnvio({ colaborador, fecha, registros: cargados.map((c) => c.registro), token }) : []);

  // Resumen ejecutivo + acción recomendada (1 llamada extra a la IA). Si falla,
  // construirHtmlLote cae al resumen determinista.
  let resumen = null;
  if (resultados.some((r) => r.ia)) {
    try {
      resumen = await consultarAnalistaResumen({ colaborador, fecha, resultados, modelo, contexto: ctx });
    } catch {
      resumen = null;
    }
  }

  const html = construirHtmlLote({ colaborador, fecha, resultados, resumen, contexto: ctx });
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
  // Redundancia del MaaS: avisos de cambio de modelo (deduplicados) — van en
  // la salida y aparte para que la plataforma los muestre como notificación.
  const avisos = avisosDeCambioDeModelo();
  for (const a of avisos) lineas.push(a);
  return { html, nombreHtml, entrada, salida: lineas.join("\n"), avisos };
}
