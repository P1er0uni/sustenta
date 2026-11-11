/** Estados de aprobación del registro diario (un día en un proyecto). */

export type EstadoAprobacion = "sin_enviar" | "enviado" | "aprobado" | "observado";

export function normalizarEstado(estado?: string | null): EstadoAprobacion {
  const limpio = (estado ?? "").trim().toLowerCase();
  if (limpio === "enviado" || limpio === "aprobado" || limpio === "observado") return limpio;
  return "sin_enviar";
}

export const ETIQUETA_ESTADO: Record<EstadoAprobacion, string> = {
  sin_enviar: "Sin enviar",
  enviado: "Enviado",
  aprobado: "Aprobado",
  observado: "Observado",
};

export const TONO_ESTADO: Record<EstadoAprobacion, "neutro" | "alerta" | "exito" | "acento"> = {
  sin_enviar: "neutro",
  enviado: "alerta",
  aprobado: "exito",
  observado: "acento",
};

/** Color del distintivo del calendario por estado. */
export const PUNTO_ESTADO: Record<EstadoAprobacion, string> = {
  sin_enviar: "bg-muted-foreground",
  enviado: "bg-warning",
  aprobado: "bg-success",
  observado: "bg-accent",
};

/** Un día enviado o aprobado no admite cambios. */
export function bloqueaRegistro(estado?: string | null): boolean {
  const e = normalizarEstado(estado);
  return e === "enviado" || e === "aprobado";
}
