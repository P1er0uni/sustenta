import { extraer } from "./extraer.mjs";
import { evaluarReglas } from "./reglas.mjs";
import { consultarGemini } from "./gemini.mjs";
import { verificarCitas } from "./citas.mjs";

const ORDEN = { sustenta: 0, sustenta_parcial: 1, ilegible: 2, no_sustenta: 3 };
const peor = (a, b) => (ORDEN[a] >= ORDEN[b] ? a : b);

/**
 * Analiza un registro con sus archivos de sustento.
 * Combina reglas deterministas + IA (Gemini). El resultado es consultivo: no aprueba ni modifica nada.
 */
export async function analizarRegistro({ registro, rutas, otrosHashes = [], modelo, sinIA = false }) {
  const archivos = [];
  for (const ruta of rutas) archivos.push(await extraer(ruta));

  const alertasReglas = archivos.flatMap((archivo) =>
    evaluarReglas({ registro, archivo, otrosHashes }).map((a) => ({ ...a, archivo: archivo.nombre })),
  );

  let ia = null;
  const hashAlterado = alertasReglas.some((a) => a.codigo === "HASH_ALTERADO");
  if (!sinIA && !hashAlterado) {
    const { veredicto, traza } = await consultarGemini({ registro, archivos, modelo });
    ia = { ...veredicto, citas: verificarCitas(veredicto.citas ?? [], archivos), traza };
    // Cita no encontrada = descartada y reportada, nunca se muestra como si fuera del documento.
    const inventadas = ia.citas.filter((c) => c.verificada === "no_encontrada");
    if (inventadas.length) {
      ia.alertas.push({
        codigo: "CITAS_NO_VERIFICADAS",
        detalle: `${inventadas.length} cita(s) de la IA no aparecen literalmente en el documento y se descartaron.`,
      });
      ia.citas = ia.citas.filter((c) => c.verificada !== "no_encontrada");
    }
  }

  // Veredicto final: una alerta crítica de las reglas manda sobre el juicio de la IA.
  let veredicto = ia?.veredicto ?? (hashAlterado ? "no_sustenta" : "sin_analisis_ia");
  if (alertasReglas.some((a) => a.severidad === "critica") && veredicto !== "sin_analisis_ia") {
    veredicto = peor(veredicto, "no_sustenta");
  }

  return {
    registroId: registro.id,
    veredicto,
    archivos: archivos.map(({ nombre, hash, huellaContenido, bytes, ext }) => ({ nombre, hash, huellaContenido, bytes, ext })),
    reglas: alertasReglas,
    ia,
  };
}
