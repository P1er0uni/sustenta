import { differenceInMinutes, parseISO } from "date-fns";

/** Origen de una reunión mostrada en la interfaz. */
export type OrigenReunion = "microsoft" | "demo";

/** Reunion normalizada, igual venga de Microsoft Graph o del modo demo. */
export interface Reunion {
  id: string;
  titulo: string;
  /** ISO de hora local Lima, ej. 2026-10-29T15:00:00 */
  inicio: string;
  fin: string;
  /** "2026-10-29" — clave para cruzar con el calendario del registro. */
  dia: string;
  organizador: string | null;
  /** Cantidad de asistentes, no la lista (privacidad mínima). */
  asistentes: number;
  /** Enlace "Unirme" de Teams cuando existe. */
  enlaceTeams: string | null;
  todoElDia: boolean;
  previa: string | null;
  origen: OrigenReunion;
}

/** Redondea a múltiplos de 0.25 con mínimo de un cuarto de hora. */
export function horasDeReunion(reunion: Reunion, jornada: number | null | undefined): number {
  const redondear = (valor: number) => Math.max(0.25, Math.round(valor * 4) / 4);
  if (reunion.todoElDia) return redondear(Number(jornada ?? 8));
  const minutos = differenceInMinutes(parseISO(reunion.fin), parseISO(reunion.inicio));
  if (!Number.isFinite(minutos) || minutos <= 0) return 0.25;
  return redondear(minutos / 60);
}
