/** Vistas enriquecidas del esquema `horas` expuestas en `public` con prefijo hr_v_. */

export interface RegistroDetalle {
  id: string;
  fecha: string;
  horas: number;
  descripcion: string | null;
  cobrable: boolean | null;
  cobrable_origen: string | null;
  cobrable_motivo: string | null;
  canal: string | null;
  estado: string | null;
  periodo_id: string;
  anio: number;
  mes: number;
  periodo_estado: string | null;
  colaborador_id: string;
  colaborador: string | null;
  documento: string | null;
  proyecto_id: string;
  proyecto_codigo: string | null;
  proyecto_nombre: string | null;
  margen_pct: number | null;
  empresa_id: string | null;
  empresa_codigo: string | null;
  empresa: string | null;
  actividad_id: string | null;
  actividad_codigo: string | null;
  actividad: string | null;
  sustentos: number | null;
  costo_hora: number | null;
  costo: number | null;
  estado_aprobacion: string | null;
  enviado_en: string | null;
  resuelto_en: string | null;
  resuelto_por: string | null;
  comentario_aprobacion: string | null;
}

export interface AsignacionDetalle {
  id: string;
  colaborador_id: string;
  colaborador: string | null;
  documento: string | null;
  jornada_horas: number | null;
  proyecto_id: string;
  proyecto_codigo: string | null;
  proyecto_nombre: string | null;
  empresa_id: string | null;
  empresa: string | null;
  margen_pct: number | null;
  rol_proyecto: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  dedicacion_pct: number | null;
  cobrable: boolean | null;
  comentario: string | null;
  horas_registradas: number | null;
}

export interface AsignacionPeriodo extends Omit<AsignacionDetalle, "id" | "fecha_inicio" | "fecha_fin"> {
  periodo_id: string;
  /** La vista mensual nombra la asignación y su vigencia con otras columnas. */
  asignacion_id: string;
  asignacion_desde: string | null;
  asignacion_hasta: string | null;
  dias_habiles_cubiertos: number | null;
  horas_esperadas: number | null;
}

export interface CapacidadFila {
  periodo_id: string;
  anio: number;
  mes: number;
  periodo_estado: string | null;
  colaborador_id: string;
  colaborador: string | null;
  documento: string | null;
  rol: string | null;
  jefe_id: string | null;
  jornada_horas: number | null;
  capacidad_bruta: number | null;
  horas_incidencia: number | null;
  capacidad_productiva: number | null;
  horas_planificadas: number | null;
  horas_registradas: number | null;
  horas_cobrables: number | null;
  costo_mensual: number | null;
  costo_hora: number | null;
  dedicacion_total_pct: number | null;
  horas_sin_asignar: number | null;
  costo_cargado: boolean;
}

export interface CumplimientoFila {
  periodo_id: string;
  anio: number;
  mes: number;
  empresa_id: string;
  empresa_codigo: string | null;
  empresa: string | null;
  colaboradores: number | null;
  horas: number | null;
  horas_cobrables: number | null;
  pct_cobrable: number | null;
  pct_con_evidencia: number | null;
  expedientes_sellados: number | null;
}

export interface LiquidacionFila {
  periodo_id: string;
  empresa_id: string;
  razon_social: string | null;
  proyecto_id: string | null;
  proyecto: string | null;
  margen_pct: number | null;
  horas_cobrables: number | null;
  horas_no_cobrables: number | null;
  costo_cobrable: number | null;
  costo_no_cobrable: number | null;
  margen: number | null;
  total_facturar: number | null;
}

export interface CostoMensual {
  id: string;
  colaborador_id: string;
  periodo_id: string;
  costo_mensual: number | null;
  capacidad_horas: number | null;
  horas_incidencia: number | null;
  horas_productivas: number | null;
  costo_hora: number | null;
}

export interface FeriadoFila {
  fecha: string;
  descripcion: string | null;
  alcance: string | null;
}

export interface IncidenciaFila {
  id: string;
  colaborador_id: string;
  tipo: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  origen: string | null;
}

export interface ChecklistItem {
  item: string;
  tipo: string;
  cumple: boolean;
  detalle: string | null;
}

/** Evidencia documental de cada registro. */
export interface SustentoVista {
  id: string;
  registro_id: string;
  nombre_archivo: string | null;
  tipo_documento: string | null;
  hash_sha256: string | null;
  tamano_bytes: number | null;
  storage_path: string | null;
  creado_en: string | null;
  colaborador_id: string | null;
  proyecto_id: string | null;
  periodo_id: string | null;
  fecha: string | null;
}

export type Severidad = "informativa" | "importante" | "critica";

export interface TipoAlerta {
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  severidad: string | null;
  destinatario: string | null;
  activo: boolean | null;
  canal_app: boolean | null;
  canal_correo: boolean | null;
  dias_antes: number | null;
  orden: number | null;
}

export interface AlertaFila {
  tipo_codigo: string;
  tipo_nombre: string | null;
  destinatario_id: string | null;
  destinatario: string | null;
  periodo_id: string | null;
  anio: number | null;
  mes: number | null;
  titulo: string | null;
  detalle: string | null;
  cantidad: number | null;
  enlace: string | null;
  severidad: string | null;
  leida_en: string | null;
  resuelta: boolean | null;
  generada_en: string | null;
}

export interface NotificacionEnvio {
  id: string;
  tipo_codigo: string | null;
  canal: string | null;
  destino: string | null;
  estado: string | null;
  intentos: number | null;
  creado_en: string | null;
  enviado_en: string | null;
  error: string | null;
}
