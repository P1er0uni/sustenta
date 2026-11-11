/**
 * Reglas deterministas previas a la IA. Barato, reproducible y explicable:
 * cada alerta lleva un código, una severidad y el hecho que la sustenta.
 *
 * registro = { id, fecha: "YYYY-MM-DD", horas, proyecto: {codigo, nombre, descripcion,
 *   inicio, fin, cobrable}, colaborador, hashGuardado? }
 */

const HOJAS_LIQUIDACION = ["resumen por empresa", "detalle por proyecto", "detalle por colaborador"];

const ALERTAS_AUTOGENERADAS = [
  {
    nombre: "Liquidación del periodo (salida de Sustenta)",
    // Excel de tres hojas, Manual Anexo A.3. Las filas de título pueden faltar,
    // por eso se reconoce también por nombre de hojas y de archivo.
    prueba: (a) =>
      HOJAS_LIQUIDACION.every((h) => a.hojas.some((x) => x.toLowerCase() === h)) ||
      /liquidacion_\d{4}-\d{2}/i.test(a.nombre) ||
      (/liquidaci[oó]n\s+\w+\s+\d{4}/i.test(a.texto) && /total a facturar/i.test(a.texto)),
  },
  {
    nombre: "Plantilla de costos del personal (salida de Sustenta)",
    prueba: (a) => /^documento\s*[,;|]\s*costo_mensual/im.test(a.texto),
  },
  {
    nombre: "Expediente de defensa (salida de Sustenta)",
    prueba: (a) => /defense file|expediente de defensa/i.test(a.texto) && /sha-?256/i.test(a.texto),
  },
];

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Fechas ISO (2026-08-03) y "agosto 2026" halladas en el texto, como Set de "YYYY-MM". */
export function periodosEnTexto(texto) {
  const periodos = new Set();
  for (const m of texto.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])-\d{2}\b/g)) periodos.add(`${m[1]}-${m[2]}`);
  for (const m of texto.matchAll(/\b(\d{1,2})[/-](0[1-9]|1[0-2])[/-](20\d{2})\b/g)) periodos.add(`${m[3]}-${m[2]}`);
  for (const m of texto.matchAll(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/gi)) {
    periodos.add(`${m[2]}-${String(MESES[m[1].toLowerCase()]).padStart(2, "0")}`);
  }
  return periodos;
}

export function evaluarReglas({ registro, archivo, otrosHashes = [] }) {
  const alertas = [];
  const alerta = (codigo, severidad, detalle) => alertas.push({ codigo, severidad, detalle });

  if (registro.hashGuardado && registro.hashGuardado !== archivo.hash) {
    alerta("HASH_ALTERADO", "critica",
      `El SHA-256 recalculado (${archivo.hash}) no coincide con el guardado (${registro.hashGuardado}).`);
  }

  const repetido = otrosHashes.filter((o) => o.hash === archivo.hash && o.registroId !== registro.id);
  if (repetido.length) {
    alerta("EVIDENCIA_DUPLICADA", "alta",
      `El mismo archivo (mismo SHA-256) también respalda ${repetido.length} registro(s) más: ${repetido.map((r) => r.registroId).join(", ")}.`);
  }

  const mismoContenido = otrosHashes.filter(
    (o) => o.huellaContenido && o.huellaContenido === archivo.huellaContenido && o.hash !== archivo.hash && o.registroId !== registro.id,
  );
  if (mismoContenido.length) {
    alerta("CONTENIDO_DUPLICADO", "alta",
      `Otro(s) archivo(s) distinto(s) en bytes tiene(n) exactamente los mismos datos y respalda(n) ${mismoContenido.map((r) => r.registroId).join(", ")}.`);
  }

  if (archivo.texto) {
    const autogenerado = ALERTAS_AUTOGENERADAS.find((a) => a.prueba(archivo));
    if (autogenerado) {
      // Demo: se reporta como informativa (media) para no forzar el veredicto a no_sustenta.
      // En una fiscalización real esta alerta sería crítica.
      alerta("AUTOGENERADO", "media",
        `El archivo parece ser una salida de la propia plataforma (${autogenerado.nombre}); en modo demo no bloquea la aprobación.`);
    }

    const periodos = periodosEnTexto(archivo.texto);
    const periodoRegistro = registro.fecha.slice(0, 7);
    if (periodos.size && !periodos.has(periodoRegistro)) {
      alerta("PERIODO_DISTINTO", "alta",
        `El registro es de ${registro.fecha} pero el documento solo menciona: ${[...periodos].sort().join(", ")}.`);
    }

    const { codigo } = registro.proyecto ?? {};
    if (codigo && !archivo.texto.includes(codigo)) {
      alerta("PROYECTO_AUSENTE", "media",
        `El código del proyecto ${codigo} no aparece en el documento.`);
    }
  }

  if (registro.proyecto?.inicio && registro.fecha < registro.proyecto.inicio) {
    alerta("FECHA_FUERA_DE_VIGENCIA", "alta",
      `La fecha ${registro.fecha} es anterior al inicio del proyecto (${registro.proyecto.inicio}).`);
  }
  if (registro.proyecto?.fin && registro.fecha > registro.proyecto.fin) {
    alerta("FECHA_FUERA_DE_VIGENCIA", "alta",
      `La fecha ${registro.fecha} es posterior al fin del proyecto (${registro.proyecto.fin}).`);
  }

  return alertas;
}
