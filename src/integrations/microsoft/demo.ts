import { eachDayOfInterval, endOfMonth, format } from "date-fns";
import type { Reunion } from "./types";

/**
 * Modo demo: reuniones de ejemplo deterministas para el mes del periodo activo.
 * Permite presentar y desarrollar la integración sin cuenta de Microsoft.
 * Nunca se mezcla con datos reales: si hay sesión de Microsoft, el modo demo queda
 * deshabilitado en el contexto.
 */

/** PRNG determinista (LCG) para que cada mes genere siempre las mismas reuniones. */
function azar(semilla: number) {
  let estado = (semilla * 2654435761) >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

interface Arquetipo {
  titulo: string;
  organizador: string;
  hora: number;
  minutos: number;
  asistentes: number;
  previa: string;
}

const PLANIFICACION_SEMANAL: Arquetipo = {
  titulo: "Planificación semanal — equipo sustento",
  organizador: "Rosa Quispe",
  hora: 9,
  minutos: 60,
  asistentes: 6,
  previa: "Prioridades de la semana, avance de registros y pendientes de evidencia.",
};

const SEGUIMIENTO_CLIENTE: Arquetipo = {
  titulo: "Seguimiento — AC Corporativo del Perú",
  organizador: "Óscar Delgado",
  hora: 11,
  minutos: 90,
  asistentes: 4,
  previa: "Estado de los proyectos intragrupo y horas comprometidas del mes.",
};

const REVISION_DEFENSE_FILE: Arquetipo = {
  titulo: "Revisión de defense file",
  organizador: "Rosa Quispe",
  hora: 16,
  minutos: 120,
  asistentes: 3,
  previa: "Recorrido del expediente propuesto y completitud de sustentos.",
};

const UNO_A_UNO: Arquetipo = {
  titulo: "1:1 con jefatura",
  organizador: "Óscar Delgado",
  hora: 10,
  minutos: 30,
  asistentes: 2,
  previa: "Ajustes de dedicación y observaciones de aprobación.",
};

function isoConHora(anio: number, mes: number, dia: number, hora: number, minutos: number) {
  const base = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  return `${base}T${String(hora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}:00`;
}

function sumarMinutos(iso: string, minutos: number) {
  const [fecha, hora] = iso.split("T");
  const partes = (hora ?? "").split(":").map(Number);
  const total = (partes[0] ?? 0) * 60 + (partes[1] ?? 0) + minutos;
  const nuevaHora = Math.floor(total / 60);
  const nuevoMin = total % 60;
  return `${fecha ?? ""}T${String(nuevaHora).padStart(2, "0")}:${String(nuevoMin).padStart(2, "0")}:00`;
}

/** Reuniones de ejemplo del mes: mismas para todos, siempre idénticas por mes. */
export function reunionesDemo(anio: number, mes: number): Reunion[] {
  const dado = azar(anio * 100 + mes);
  const dias = eachDayOfInterval({
    start: new Date(anio, mes - 1, 1),
    end: endOfMonth(new Date(anio, mes - 1, 1)),
  });
  const reuniones: Reunion[] = [];
  let indice = 0;

  const agregar = (dia: Date, arquetipo: Arquetipo) => {
    const numeroDia = dia.getDate();
    const inicio = isoConHora(anio, mes, numeroDia, arquetipo.hora, 0);
    reuniones.push({
      id: `demo-${anio}${String(mes).padStart(2, "0")}-${indice}`,
      titulo: arquetipo.titulo,
      inicio,
      fin: sumarMinutos(inicio, arquetipo.minutos),
      dia: format(dia, "yyyy-MM-dd"),
      organizador: arquetipo.organizador,
      asistentes: arquetipo.asistentes,
      enlaceTeams: null,
      todoElDia: false,
      previa: arquetipo.previa,
      origen: "demo",
    });
    indice += 1;
  };

  for (const dia of dias) {
    const diaSemana = dia.getDay();
    const semana = Math.floor((dia.getDate() - 1) / 7);
    if (diaSemana === 1) agregar(dia, PLANIFICACION_SEMANAL);
    if (diaSemana === 3) agregar(dia, SEGUIMIENTO_CLIENTE);
    // Revisión de defense file: jueves de la segunda y cuarta semana.
    if (diaSemana === 4 && (semana === 1 || semana === 3)) agregar(dia, REVISION_DEFENSE_FILE);
    // 1:1 con jefatura: viernes de semanas alternas.
    if (diaSemana === 5 && semana % 2 === 0) agregar(dia, UNO_A_UNO);
  }

  // Capacitación tributaria: un día laborable al azar del mes, 15:00, 90 min.
  const laborables = dias.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  const elegido = laborables[Math.floor(dado() * laborables.length)];
  if (elegido) {
    agregar(elegido, {
      titulo: "Capacitación tributaria — servicios intragrupo",
      organizador: "María Ferreyros",
      hora: 15,
      minutos: 90,
      asistentes: 12,
      previa: "Novedades normativas y criterios de cobrabilidad aplicables al periodo.",
    });
  }

  return reuniones.sort((a, b) => a.inicio.localeCompare(b.inicio));
}
