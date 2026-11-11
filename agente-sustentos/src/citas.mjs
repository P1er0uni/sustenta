/**
 * Verifica que cada cita de la IA exista literalmente en el documento.
 * Una cita que no aparece se descarta: es la defensa contra alucinaciones.
 */
const normalizar = (t) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\|\s*/g, " ") // las celdas de xlsx se vuelcan separadas por " | "
    .replace(/^\d+:\s/gm, "") // numeración de filas del volcado
    .replace(/[“”«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function verificarCitas(citas, archivos) {
  const textos = new Map(archivos.map((a) => [a.nombre, a.texto ? normalizar(a.texto) : null]));
  return citas.map((c) => {
    const candidatos = textos.has(c.archivo) ? [c.archivo] : [...textos.keys()];
    const fuentes = candidatos.filter((n) => textos.get(n) !== null);
    if (fuentes.length === 0) return { ...c, verificada: "no_verificable_localmente" };
    const aguja = normalizar(c.texto);
    const hallada = aguja.length > 0 && fuentes.some((n) => textos.get(n).includes(aguja));
    return { ...c, verificada: hallada ? "literal" : "no_encontrada" };
  });
}
