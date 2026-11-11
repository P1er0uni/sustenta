export type Rol = "colaborador" | "jefatura" | "administracion" | "finanzas" | "tributaria";

export interface Colaborador {
  id: string;
  nombre?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  email?: string | null;
  rol: Rol;
  cargo?: string | null;
  empresa_id?: string | null;
  activo?: boolean | null;
}

export interface EmpresaVinculada {
  id: string;
  nombre?: string | null;
  razon_social?: string | null;
  ruc?: string | null;
  pais?: string | null;
}

export interface Proyecto {
  id: string;
  nombre?: string | null;
  codigo?: string | null;
  empresa_id?: string | null;
  estado?: string | null;
  cobrable?: boolean | null;
}

export interface Actividad {
  id: string;
  nombre?: string | null;
  codigo?: string | null;
  descripcion?: string | null;
  activo?: boolean | null;
}

export interface Asignacion {
  id: string;
  proyecto_id: string;
  colaborador_id: string;
  rol?: string | null;
  rol_proyecto?: string | null;
  dedicacion?: number | null;
  dedicacion_pct?: number | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  cobrable?: boolean | null;
  cobrabilidad?: string | null;
  colaborador?: Colaborador | null;
  proyecto?: Proyecto | null;
}

export interface Periodo {
  id: string;
  anio?: number | null;
  mes?: number | null;
  nombre?: string | null;
  codigo?: string | null;
  estado?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  observacion?: string | null;
  cerrado_en?: string | null;
  cerrado_por?: string | null;
  exige_aprobacion?: boolean | null;
}

export interface Feriado {
  id: string;
  fecha: string;
  nombre?: string | null;
}

export interface Incidencia {
  id: string;
  colaborador_id: string;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  tipo?: string | null;
}

export interface RegistroHora {
  id: string;
  colaborador_id: string;
  proyecto_id: string;
  asignacion_id?: string | null;
  actividad_id?: string | null;
  fecha: string;
  horas: number;
  descripcion?: string | null;
  cobrable?: boolean | null;
  cobrabilidad?: string | null;
  empresa_receptora_id?: string | null;
  canal?: string | null;
  estado?: string | null;
}

export interface DefenseFile {
  id: string;
  empresa_id: string;
  periodo_id: string;
  estado?: string | null;
  contenido?: unknown;
  payload?: unknown;
  json?: unknown;
  hash?: string | null;
  hash_sha256?: string | null;
  confirmado_por?: string | null;
  confirmado_en?: string | null;
  creado_en?: string | null;
}

export function nombreColaborador(c?: Colaborador | null): string {
  if (!c) return "—";
  return (
    c.nombre ||
    [c.nombres, c.apellidos].filter(Boolean).join(" ").trim() ||
    c.email ||
    "Sin nombre"
  );
}

export function nombreEmpresa(e?: EmpresaVinculada | null): string {
  if (!e) return "—";
  return e.nombre || e.razon_social || e.ruc || "Sin nombre";
}

export function nombrePeriodo(p?: Periodo | null): string {
  if (!p) return "—";
  if (p.nombre) return p.nombre;
  if (p.codigo) return p.codigo;
  if (p.anio && p.mes) return `${p.anio}-${String(p.mes).padStart(2, "0")}`;
  return p.id.slice(0, 8);
}
