import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Circle,
  Clock3,
  Lock,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { EstadoConexionMicrosoft, FilaReunion } from "@/components/reuniones";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { useCuentaMicrosoft } from "@/context/microsoft";
import { useReuniones } from "@/integrations/microsoft/hooks";
import { horasDeReunion, type Reunion } from "@/integrations/microsoft/types";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { Actividad, Feriado, Incidencia, RegistroHora } from "@/integrations/sustenta/types";
import type {
  AsignacionPeriodo,
  CapacidadFila,
  RegistroDetalle,
} from "@/integrations/sustenta/vistas";
import {
  ETIQUETA_ESTADO,
  PUNTO_ESTADO,
  TONO_ESTADO,
  bloqueaRegistro,
  normalizarEstado,
  type EstadoAprobacion,
} from "@/lib/aprobacion";
import { etiquetaPeriodo, fechaCorta, horasMinutos, n, pct, rangoMes } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/horas/registro")({
  head: () => ({
    meta: [
      { title: "Registro de horas — Sustenta" },
      {
        name: "description",
        content: "Tablero personal de compromisos, calendario y registro diario de horas.",
      },
      { property: "og:title", content: "Registro de horas — Sustenta" },
      {
        property: "og:description",
        content: "Compromisos mensuales y registro diario de horas con evidencia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RegistroHoras,
});

const PALETA = [
  {
    punto: "bg-project-1",
    suave: "bg-project-1-soft",
    texto: "text-project-1",
    borde: "border-project-1",
  },
  {
    punto: "bg-project-2",
    suave: "bg-project-2-soft",
    texto: "text-project-2",
    borde: "border-project-2",
  },
  {
    punto: "bg-project-3",
    suave: "bg-project-3-soft",
    texto: "text-project-3",
    borde: "border-project-3",
  },
  {
    punto: "bg-project-4",
    suave: "bg-project-4-soft",
    texto: "text-project-4",
    borde: "border-project-4",
  },
  {
    punto: "bg-project-5",
    suave: "bg-project-5-soft",
    texto: "text-project-5",
    borde: "border-project-5",
  },
  {
    punto: "bg-project-6",
    suave: "bg-project-6-soft",
    texto: "text-project-6",
    borde: "border-project-6",
  },
] as const;

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const ARCHIVOS_ACEPTADOS = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx";

function colorProyecto(indice: number) {
  return PALETA[indice % PALETA.length] ?? PALETA[0];
}

function iso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function incluyeFecha(
  inicio: string | null | undefined,
  fin: string | null | undefined,
  fecha: string,
) {
  return (!inicio || fecha >= inicio) && (!fin || fecha <= fin);
}

function abreviarIncidencia(tipo: string | null | undefined) {
  const limpio = (tipo ?? "INC").trim().toUpperCase();
  if (limpio.startsWith("VAC")) return "VAC";
  if (limpio.startsWith("PERM")) return "PERM";
  if (limpio.startsWith("DESC")) return "DESC";
  if (limpio.startsWith("LIC")) return "LIC";
  return limpio.slice(0, 4);
}

function RegistroHoras() {
  const { colaborador, periodos } = useSesion();
  const qc = useQueryClient();
  const colaboradorId = colaborador?.id ?? null;
  // Periodos abiertos: puede haber más de uno. El colaborador elige cuál editar.
  const periodosAbiertos = useMemo(
    () => periodos.filter((p) => (p.estado ?? "").toLowerCase() === "abierto"),
    [periodos],
  );
  const [periodoIdSel, setPeriodoIdSel] = useState("");
  const periodo = useMemo(
    () => periodosAbiertos.find((p) => p.id === periodoIdSel) ?? periodosAbiertos[0] ?? null,
    [periodosAbiertos, periodoIdSel],
  );
  const periodoId = periodo?.id ?? "";
  const rango = periodo?.anio && periodo?.mes ? rangoMes(periodo.anio, periodo.mes) : null;
  const mes = periodo?.anio && periodo?.mes ? new Date(periodo.anio, periodo.mes - 1, 1) : null;
  const habilitado = sustentaConfigurado && !!colaboradorId && !!periodoId && !!rango;

  const [asignacionId, setAsignacionId] = useState("");
  const [fechaSeleccionada, setFechaSeleccionada] = useState<string | null>(null);
  const [actividadId, setActividadId] = useState("");
  const [horas, setHoras] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorBD, setErrorBD] = useState<string | null>(null);
  const [dialogoEnvio, setDialogoEnvio] = useState(false);
  const [diasSeleccionados, setDiasSeleccionados] = useState<string[]>([]);

  // Al cambiar de mes, limpiar el formulario para no arrastrar selección ni
  // fechas de un periodo anterior (la asignación y los días seleccionados ya
  // no aplican al nuevo periodo).
  useEffect(() => {
    setAsignacionId("");
    setFechaSeleccionada(null);
    setActividadId("");
    setHoras("");
    setDescripcion("");
    setArchivo(null);
    setDiasSeleccionados([]);
  }, [periodoId]);

  const asignacionesQ = useQuery({
    queryKey: ["mis-asignaciones-periodo", colaboradorId, periodoId],
    enabled: habilitado,
    queryFn: async () => {
      if (!colaboradorId || !periodoId) return [];
      const { data, error } = await sustenta
        .from("hr_v_asignacion_periodo")
        .select("*")
        .eq("colaborador_id", colaboradorId)
        .eq("periodo_id", periodoId)
        .order("proyecto_codigo");
      if (error) throw error;
      return (data ?? []) as AsignacionPeriodo[];
    },
  });

  const registrosQ = useQuery({
    queryKey: ["registros-detalle", colaboradorId, periodoId],
    enabled: habilitado,
    queryFn: async () => {
      if (!colaboradorId || !rango) return [];
      const { data, error } = await sustenta
        .from("hr_v_registro_detalle")
        .select("*")
        .eq("colaborador_id", colaboradorId)
        .gte("fecha", rango.inicio)
        .lte("fecha", rango.fin)
        .order("fecha");
      if (error) throw error;
      return (data ?? []) as RegistroDetalle[];
    },
  });

  const capacidadQ = useQuery({
    queryKey: ["mi-capacidad", periodoId, colaboradorId],
    enabled: habilitado,
    queryFn: async () => {
      if (!colaboradorId || !periodoId) return null;
      const { data, error } = await sustenta
        .from("hr_v_capacidad")
        .select("*")
        .eq("periodo_id", periodoId)
        .eq("colaborador_id", colaboradorId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CapacidadFila | null;
    },
  });

  const feriadosQ = useQuery({
    queryKey: ["feriados", rango?.inicio],
    enabled: habilitado,
    queryFn: async () => {
      if (!rango) return [];
      const { data, error } = await sustenta
        .from("hr_feriado")
        .select("*")
        .gte("fecha", rango.inicio)
        .lte("fecha", rango.fin);
      if (error) throw error;
      return (data ?? []) as Feriado[];
    },
  });

  const incidenciasQ = useQuery({
    queryKey: ["mis-incidencias", colaboradorId, rango?.inicio],
    enabled: habilitado,
    queryFn: async () => {
      if (!colaboradorId || !rango) return [];
      const { data, error } = await sustenta
        .from("hr_incidencia")
        .select("*")
        .eq("colaborador_id", colaboradorId)
        .lte("fecha_inicio", rango.fin)
        .gte("fecha_fin", rango.inicio);
      if (error) throw error;
      return (data ?? []) as Incidencia[];
    },
  });

  const actividadesQ = useQuery({
    queryKey: ["actividades"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_actividad")
        .select("*")
        .eq("activo", true)
        .order("nombre");
      if (error) throw error;
      return (data ?? []) as Actividad[];
    },
  });

  // Reuniones de Outlook/Teams del mes: cuenta Microsoft, modo demo o nada.
  const { cuenta, modoDemo, conectar } = useCuentaMicrosoft();
  const reunionesQ = useReuniones(
    periodo?.anio && periodo?.mes && rango
      ? { inicio: rango.inicio, fin: rango.fin, anio: periodo.anio, mes: periodo.mes }
      : null,
  );
  const reuniones = reunionesQ.data ?? [];
  const reunionesPorDia = useMemo(() => {
    const mapa = new Map<string, Reunion[]>();
    for (const reunion of reuniones) {
      const lista = mapa.get(reunion.dia);
      if (lista) lista.push(reunion);
      else mapa.set(reunion.dia, [reunion]);
    }
    return mapa;
  }, [reuniones]);
  const reunionesDelDia = fechaSeleccionada ? (reunionesPorDia.get(fechaSeleccionada) ?? []) : [];
  const horasEnReuniones = reunionesDelDia.reduce(
    (suma, r) => suma + differenceInMinutes(parseISO(r.fin), parseISO(r.inicio)) / 60,
    0,
  );

  function registrarDesdeReunion(reunion: Reunion) {
    setFechaSeleccionada(reunion.dia);
    setHoras(String(horasDeReunion(reunion, cap?.jornada_horas)));
    setDescripcion(
      reunion.organizador
        ? `${reunion.titulo} — organizada por ${reunion.organizador}`
        : reunion.titulo,
    );
  }

  const asignaciones = asignacionesQ.data ?? [];
  const registros = registrosQ.data ?? [];
  const feriados = feriadosQ.data ?? [];
  const incidencias = incidenciasQ.data ?? [];
  const asignacion =
    asignaciones.find((a) => a.asignacion_id === asignacionId) ?? asignaciones[0] ?? null;
  const colorSeleccionado = colorProyecto(
    Math.max(0, asignacion ? asignaciones.indexOf(asignacion) : 0),
  );
  const cap = capacidadQ.data;
  const dias = useMemo(
    () => (mes ? eachDayOfInterval({ start: startOfMonth(mes), end: endOfMonth(mes) }) : []),
    [mes],
  );
  const hoy = iso(new Date());

  function feriadoEn(fecha: string) {
    return feriados.find((f) => f.fecha === fecha) ?? null;
  }

  function incidenciaEn(fecha: string) {
    return (
      incidencias.find((i) => {
        const inicio = i.fecha_inicio?.slice(0, 10) ?? null;
        const fin = i.fecha_fin?.slice(0, 10) ?? inicio;
        return incluyeFecha(inicio, fin, fecha);
      }) ?? null
    );
  }

  function esNoLaborable(fecha: string, dia: Date) {
    return dia.getDay() === 0 || dia.getDay() === 6 || !!feriadoEn(fecha) || !!incidenciaEn(fecha);
  }

  function asignacionesDelDia(fecha: string, dia: Date) {
    if (esNoLaborable(fecha, dia)) return [];
    return asignaciones.filter((a) => incluyeFecha(a.asignacion_desde, a.asignacion_hasta, fecha));
  }

  function esperadoDelDia(fecha: string, dia: Date) {
    return asignacionesDelDia(fecha, dia).reduce(
      (suma, a) =>
        suma +
        (Number(a.jornada_horas ?? cap?.jornada_horas ?? 0) * Number(a.dedicacion_pct ?? 0)) / 100,
      0,
    );
  }

  function registradoDelDia(fecha: string) {
    return registros
      .filter((r) => r.fecha === fecha)
      .reduce((suma, r) => suma + Number(r.horas ?? 0), 0);
  }

  const seleccionadoDentro =
    !!asignacion &&
    !!fechaSeleccionada &&
    incluyeFecha(asignacion.asignacion_desde, asignacion.asignacion_hasta, fechaSeleccionada);
  const diaSeleccionado = fechaSeleccionada ? parseISO(fechaSeleccionada) : null;
  const registrosDelDia = fechaSeleccionada
    ? registros.filter((r) => r.fecha === fechaSeleccionada)
    : [];
  const descripcionValida = descripcion.trim().length >= 10;
  const errores =
    asignacionesQ.error ??
    registrosQ.error ??
    capacidadQ.error ??
    feriadosQ.error ??
    incidenciasQ.error;

  function estadoDelDia(fecha: string): EstadoAprobacion | null {
    const delDia = registros.filter((r) => r.fecha === fecha);
    if (delDia.length === 0) return null;
    const estados = delDia.map((r) => normalizarEstado(r.estado_aprobacion));
    if (estados.includes("observado")) return "observado";
    if (estados.includes("sin_enviar")) return "sin_enviar";
    if (estados.includes("enviado")) return "enviado";
    return "aprobado";
  }

  const registrosDiaProyecto =
    fechaSeleccionada && asignacion
      ? registros.filter(
          (r) => r.fecha === fechaSeleccionada && r.proyecto_id === asignacion.proyecto_id,
        )
      : [];
  const diaBloqueado = registrosDiaProyecto.some((r) => bloqueaRegistro(r.estado_aprobacion));
  const estadoDiaProyecto = registrosDiaProyecto.some(
    (r) => normalizarEstado(r.estado_aprobacion) === "aprobado",
  )
    ? "aprobado"
    : registrosDiaProyecto.some((r) => normalizarEstado(r.estado_aprobacion) === "enviado")
      ? "enviado"
      : registrosDiaProyecto.some((r) => normalizarEstado(r.estado_aprobacion) === "observado")
        ? "observado"
        : "sin_enviar";
  const comentarioDia =
    registrosDiaProyecto.find((r) => normalizarEstado(r.estado_aprobacion) === "observado")
      ?.comentario_aprobacion ?? null;

  const registrosSinEvidencia = registros.filter((r) => Number(r.sustentos ?? 0) === 0);
  const horasDelMes = registros.reduce((s, r) => s + Number(r.horas ?? 0), 0);
  const enviables = registros.filter((r) => normalizarEstado(r.estado_aprobacion) === "sin_enviar");
  const marcados = diasSeleccionados.filter((id) => enviables.some((r) => r.id === id));
  const registrosMarcados = registros.filter((r) => marcados.includes(r.id));
  const marcadosSinEvidencia = registrosMarcados.filter(
    (r) => Number(r.sustentos ?? 0) === 0,
  ).length;

  function seleccionarSemana() {
    const referencia = fechaSeleccionada ? parseISO(fechaSeleccionada) : new Date();
    const desde = iso(startOfWeek(referencia, { weekStartsOn: 1 }));
    const hasta = iso(endOfWeek(referencia, { weekStartsOn: 1 }));
    setDiasSeleccionados(
      enviables.filter((r) => r.fecha >= desde && r.fecha <= hasta).map((r) => r.id),
    );
  }

  async function refrescarTablero() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["registros-detalle"] }),
      qc.invalidateQueries({ queryKey: ["mis-asignaciones-periodo"] }),
      qc.invalidateQueries({ queryKey: ["mi-capacidad"] }),
      qc.invalidateQueries({ queryKey: ["alertas"] }),
    ]);
  }

  const enviarRegistros = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await sustenta.rpc("hr_enviar_registros", { p_ids: ids });
      if (error) throw error;
      return typeof data === "string" ? data : `${ids.length} días enviados a aprobación`;
    },
    onSuccess: async (texto) => {
      setErrorBD(null);
      setDialogoEnvio(false);
      setDiasSeleccionados([]);
      toast.success(texto);
      await refrescarTablero();
    },
    onError: (error) => {
      const mensaje = mensajeDeError(error);
      setErrorBD(mensaje);
      toast.error(mensaje);
    },
  });

  const guardar = useMutation({
    mutationFn: async () => {
      if (!fechaSeleccionada || !asignacion || !colaboradorId)
        throw new Error("Selecciona un día y un proyecto.");
      const { data, error } = await sustenta
        .from("hr_registro_hora")
        .insert({
          colaborador_id: colaboradorId,
          proyecto_id: asignacion.proyecto_id,
          actividad_id: actividadId || null,
          fecha: fechaSeleccionada,
          horas: Number(horas),
          descripcion,
        })
        .select("*")
        .single();
      if (error) throw error;
      const registro = data as RegistroHora;

      if (archivo) {
        const partes = fechaSeleccionada.split("-");
        const ruta = `horas/${partes[0]}/${partes[1]}/${registro.id}-${archivo.name}`;
        const subida = await sustenta.storage.from("sustentos").upload(ruta, archivo, {
          upsert: true,
          contentType: archivo.type || "application/octet-stream",
        });
        if (subida.error) throw subida.error;
        const digest = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer());
        const hash = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const { error: errorSustento } = await sustenta.from("hr_sustento").insert({
          registro_id: registro.id,
          nombre_archivo: archivo.name,
          tipo_documento: archivo.type || archivo.name.split(".").pop() || "archivo",
          hash_sha256: hash,
          tamano_bytes: archivo.size,
          storage_path: ruta,
        });
        if (errorSustento) throw errorSustento;
      }
      return registro;
    },
    onSuccess: async () => {
      setErrorBD(null);
      setHoras("");
      setDescripcion("");
      setArchivo(null);
      toast.success("Registro guardado");
      await refrescarTablero();
    },
    onError: (error) => {
      const mensaje = mensajeDeError(error);
      setErrorBD(mensaje);
      toast.error(mensaje);
    },
  });

  const eliminar = useMutation({
    mutationFn: async (registroId: string) => {
      const { error } = await sustenta.from("hr_registro_hora").delete().eq("id", registroId);
      if (error) throw error;
    },
    onSuccess: async () => {
      setErrorBD(null);
      toast.success("Registro eliminado");
      await refrescarTablero();
    },
    onError: (error) => {
      const mensaje = mensajeDeError(error);
      setErrorBD(mensaje);
      toast.error(mensaje);
    },
  });

  if (!periodo || !rango || !mes) {
    return (
      <AppShell>
        <PageHeader
          titulo="Registro de horas"
          descripcion="Tu tablero personal de compromisos y carga diaria."
        />
        <Card>
          <div className="p-6">
            <Aviso tono="alerta" titulo="No hay un periodo abierto">
              Administración debe aperturar un periodo antes de que puedas registrar horas.
            </Aviso>
            <Link
              to="/horas/capacidad"
              className="mt-4 inline-flex text-[12px] font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Ver meses cerrados
            </Link>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        titulo="Registro de horas"
        descripcion={`Tu tablero de ${format(mes, "MMMM yyyy", { locale: es })}: compromisos, avance y carga diaria.`}
        acciones={[{ label: "Ver meses cerrados", to: "/horas/capacidad" }]}
      />

      {periodosAbiertos.length > 1 ? (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-muted-foreground">Mes abierto:</span>
          <select
            value={periodo?.id ?? ""}
            onChange={(e) => setPeriodoIdSel(e.target.value)}
            className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-foreground outline-none focus:border-accent"
          >
            {periodosAbiertos.map((p) => (
              <option key={p.id} value={p.id}>
                {etiquetaPeriodo(p.anio, p.mes)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {errores ? (
        <Aviso tono="alerta" titulo="La base de datos respondió">
          {mensajeDeError(errores)}
        </Aviso>
      ) : null}

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[280px_minmax(520px,1fr)_340px]">
        <Card className="order-3 xl:order-none">
          <CardHeader
            titulo="Mis proyectos del mes"
            descripcion="Selecciona el compromiso que vas a registrar."
          />
          {asignaciones.length === 0 ? (
            <Vacio
              mensaje={`No tienes proyectos asignados en ${format(mes, "MMMM", { locale: es })}.`}
            />
          ) : (
            <div className="flex gap-2 overflow-x-auto p-3 xl:block xl:space-y-2 xl:overflow-visible">
              {asignaciones.map((a, indice) => {
                const color = colorProyecto(indice);
                const activo = a.asignacion_id === asignacion?.asignacion_id;
                const esperado = Number(a.horas_esperadas ?? 0);
                const registrado = Number(a.horas_registradas ?? 0);
                const avance = esperado > 0 ? Math.min(100, (registrado / esperado) * 100) : 0;
                return (
                  <button
                    key={a.asignacion_id}
                    type="button"
                    onClick={() => {
                      setAsignacionId(a.asignacion_id);
                      if (
                        fechaSeleccionada &&
                        !incluyeFecha(a.asignacion_desde, a.asignacion_hasta, fechaSeleccionada)
                      )
                        setFechaSeleccionada(null);
                    }}
                    className={cn(
                      "w-[230px] shrink-0 rounded-[6px] border p-3 text-left transition-colors xl:w-full xl:shrink",
                      activo
                        ? cn(color.suave, color.borde)
                        : "border-border bg-surface hover:bg-surface-muted",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", color.punto)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold">
                          <Num>{a.proyecto_codigo ?? "—"}</Num> ·{" "}
                          {a.proyecto_nombre ?? "Sin nombre"}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {a.empresa ?? "Empresa no disponible"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <Num>
                        {fechaCorta(a.asignacion_desde)} – {fechaCorta(a.asignacion_hasta)}
                      </Num>
                      <Num className={cn("font-semibold", color.texto)}>
                        {n(a.dedicacion_pct, 0)}%
                      </Num>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className={cn("h-full rounded-full", color.punto)}
                        style={{ width: `${avance}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-right text-[11px] text-muted-foreground">
                      <Num>
                        {horasMinutos(registrado)} / {horasMinutos(esperado)}
                      </Num>
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="order-1 xl:order-none">
          <CardHeader
            titulo={format(mes, "MMMM yyyy", { locale: es })}
            descripcion={
              asignacion
                ? `${asignacion.proyecto_codigo ?? ""} · ${asignacion.proyecto_nombre ?? ""}`
                : "Sin proyecto seleccionado"
            }
          />
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" />
                Carga completa
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" />
                Carga parcial
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning-soft ring-1 ring-warning/30" />
                Incidencia
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-surface-muted ring-1 ring-border" />
                No laborable
              </span>
              <span className="flex items-center gap-1">
                <Video className="h-2.5 w-2.5 text-info" />
                Reuniones
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {DIAS.map((nombre, i) => (
                <span key={`${nombre}-${i}`} className="label-xs py-1 text-center">
                  {nombre}
                </span>
              ))}
              {Array.from({ length: (startOfMonth(mes).getDay() + 6) % 7 }).map((_, i) => (
                <span key={`vacio-${i}`} />
              ))}
              {dias.map((dia) => {
                const fecha = iso(dia);
                const feriado = feriadoEn(fecha);
                const incidencia = incidenciaEn(fecha);
                const reunionesDia = reunionesPorDia.get(fecha) ?? [];
                const finSemana = dia.getDay() === 0 || dia.getDay() === 6;
                const dentro = asignacion
                  ? incluyeFecha(asignacion.asignacion_desde, asignacion.asignacion_hasta, fecha)
                  : false;
                const laborable = dentro && !finSemana && !feriado && !incidencia;
                const asignacionesDia = asignacionesDelDia(fecha, dia);
                const totalDedicacion = asignacionesDia.reduce(
                  (s, a) => s + Number(a.dedicacion_pct ?? 0),
                  0,
                );
                const esperado = esperadoDelDia(fecha, dia);
                const registrado = registradoDelDia(fecha);
                const futuro = fecha > hoy;
                const completo =
                  !futuro && registrado > 0 && esperado > 0 && registrado >= esperado;
                const parcial = !futuro && registrado > 0 && !completo;
                const seleccionado = fechaSeleccionada === fecha;
                return (
                  <button
                    key={fecha}
                    type="button"
                    disabled={!laborable}
                    onClick={() => setFechaSeleccionada(fecha)}
                    title={
                      feriado?.nombre ??
                      incidencia?.tipo ??
                      (!dentro ? "Fuera de la vigencia de la asignación" : undefined)
                    }
                    className={cn(
                      "relative min-h-20 rounded-[6px] border p-2 text-left transition-colors",
                      !dentro && "border-border bg-surface-muted/60 text-muted-foreground",
                      dentro &&
                        (finSemana || feriado) &&
                        "border-border bg-surface-muted text-muted-foreground",
                      dentro && incidencia && "border-warning/35 bg-warning-soft text-warning",
                      laborable &&
                        cn(colorSeleccionado.suave, "hover:brightness-95", colorSeleccionado.borde),
                      seleccionado && "ring-2 ring-foreground ring-offset-1",
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <Num className="text-[12px] font-semibold">{format(dia, "d")}</Num>
                      <span className="flex items-center gap-1">
                        {reunionesDia.length > 0 ? (
                          <span
                            className="flex items-center gap-0.5 text-info"
                            title={`${n(reunionesDia.length, 0)} reuniones`}
                          >
                            <Video className="h-2.5 w-2.5" />
                            <Num className="text-[9px] font-bold">{n(reunionesDia.length, 0)}</Num>
                          </span>
                        ) : null}
                        {estadoDelDia(fecha) ? (
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              PUNTO_ESTADO[estadoDelDia(fecha)!],
                            )}
                            title={`Aprobación: ${ETIQUETA_ESTADO[estadoDelDia(fecha)!]}`}
                          />
                        ) : null}
                        {completo ? (
                          <span
                            className="h-2 w-2 rounded-full bg-success"
                            title="Carga completa"
                          />
                        ) : parcial ? (
                          <span className="h-2 w-2 rounded-full bg-warning" title="Carga parcial" />
                        ) : null}
                      </span>
                    </div>
                    {laborable ? (
                      <Num
                        className={cn("mt-2 block text-[12px] font-bold", colorSeleccionado.texto)}
                      >
                        {n(asignacion?.dedicacion_pct, 0)}%
                      </Num>
                    ) : null}
                    {incidencia ? (
                      <span className="mt-2 block text-[10px] font-bold">
                        {abreviarIncidencia(incidencia.tipo)}
                      </span>
                    ) : null}
                    {feriado ? (
                      <span className="mt-2 block truncate text-[9px] font-semibold">Feriado</span>
                    ) : null}
                    {finSemana && dentro && !feriado ? (
                      <span className="mt-2 block text-[9px]">Fin de semana</span>
                    ) : null}
                    {laborable && asignacionesDia.length > 1 ? (
                      <span
                        className={cn(
                          "absolute bottom-1.5 left-2 text-[9px]",
                          totalDedicacion > 100
                            ? "font-bold text-warning"
                            : "text-muted-foreground",
                        )}
                      >
                        total <Num>{n(totalDedicacion, 0)}%</Num>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="order-2 space-y-4 xl:order-none">
          <Card>
            <CardHeader
              titulo={
                diaSeleccionado
                  ? format(diaSeleccionado, "EEEE d 'de' MMMM", { locale: es })
                  : "Registro del día"
              }
              descripcion={
                asignacion
                  ? `${asignacion.proyecto_codigo ?? ""} · ${asignacion.proyecto_nombre ?? ""}`
                  : "Selecciona un proyecto"
              }
            />
            {!diaSeleccionado ? (
              <Vacio mensaje="Selecciona un día habilitado del calendario." />
            ) : !seleccionadoDentro ? (
              <div className="p-4">
                <Aviso tono="neutro">
                  El día está fuera de la vigencia de la asignación seleccionada.
                </Aviso>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <div>
                  <Etiqueta>Proyecto</Etiqueta>
                  <select
                    className="field mt-1"
                    value={asignacion?.asignacion_id ?? ""}
                    onChange={(e) => setAsignacionId(e.target.value)}
                  >
                    {asignaciones
                      .filter((a) =>
                        incluyeFecha(a.asignacion_desde, a.asignacion_hasta, fechaSeleccionada),
                      )
                      .map((a) => (
                        <option key={a.asignacion_id} value={a.asignacion_id}>
                          {a.proyecto_codigo} · {a.proyecto_nombre}
                        </option>
                      ))}
                  </select>
                </div>
                {estadoDiaProyecto === "observado" ? (
                  <Aviso tono="acento" titulo="Tu jefatura observó este día">
                    {comentarioDia ?? "Sin comentario registrado."}
                  </Aviso>
                ) : null}
                {diaBloqueado ? (
                  <Aviso
                    tono="alerta"
                    titulo={`Día ${ETIQUETA_ESTADO[estadoDiaProyecto].toLowerCase()}`}
                  >
                    Un día enviado o aprobado no admite cambios. Espera la respuesta de tu jefatura
                    para poder corregir.
                  </Aviso>
                ) : (
                  <>
                    <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-3">
                      <div>
                        <Etiqueta>Actividad</Etiqueta>
                        <select
                          className="field mt-1"
                          value={actividadId}
                          onChange={(e) => setActividadId(e.target.value)}
                        >
                          <option value="">Selecciona</option>
                          {(actividadesQ.data ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.nombre ?? a.codigo}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Etiqueta>Horas</Etiqueta>
                        <input
                          className="field num mt-1"
                          type="number"
                          step="0.25"
                          min="0.25"
                          max="24"
                          value={horas}
                          onChange={(e) => setHoras(e.target.value)}
                          placeholder="0:00"
                        />
                      </div>
                    </div>
                    <div>
                      <Etiqueta>Descripción (mínimo 10 caracteres)</Etiqueta>
                      <textarea
                        className="field mt-1 min-h-24"
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                        placeholder="Actividad, entregable y contraparte."
                      />
                      <p
                        className={cn(
                          "mt-1 text-[10px]",
                          descripcionValida ? "text-muted-foreground" : "text-accent",
                        )}
                      >
                        <Num>{descripcion.trim().length}</Num> / 10
                      </p>
                    </div>
                    <div>
                      <Etiqueta>Evidencia</Etiqueta>
                      <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-[6px] border border-dashed border-border-strong px-3 py-3 text-[12px] text-muted-foreground hover:border-accent">
                        {archivo ? (
                          <Paperclip className="h-4 w-4" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        <span className="min-w-0 truncate">
                          {archivo?.name ?? "Selecciona un archivo"}
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          accept={ARCHIVOS_ACEPTADOS}
                          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        PDF, PNG, JPG, DOCX, XLSX o PPTX
                      </p>
                    </div>
                    {errorBD ? (
                      <Aviso tono="acento" titulo="La base respondió">
                        {errorBD}
                      </Aviso>
                    ) : null}
                    <Button
                      variante="primario"
                      className="w-full"
                      cargando={guardar.isPending}
                      disabled={!descripcionValida || !horas || !actividadId || !asignacion}
                      onClick={() => guardar.mutate()}
                    >
                      Guardar registro
                    </Button>
                  </>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              titulo="Reuniones del día"
              descripcion={
                diaSeleccionado
                  ? format(diaSeleccionado, "EEEE d 'de' MMMM", { locale: es })
                  : "Outlook / Teams"
              }
              accion={
                modoDemo ? (
                  <Badge tono="alerta">Ejemplo</Badge>
                ) : reunionesDelDia.length > 0 ? (
                  <Badge tono="info">
                    <Num>{horasMinutos(horasEnReuniones)}</Num>
                  </Badge>
                ) : null
              }
            />
            {reunionesQ.error ? (
              <div className="space-y-2 p-4">
                <Aviso tono="alerta" titulo="Microsoft Graph respondió">
                  {mensajeDeError(reunionesQ.error)}
                </Aviso>
                <Button variante="secundario" onClick={() => void conectar()}>
                  Reconectar
                </Button>
              </div>
            ) : !cuenta && !modoDemo ? (
              <EstadoConexionMicrosoft />
            ) : !diaSeleccionado ? (
              <Vacio mensaje="Selecciona un día del calendario para ver sus reuniones." />
            ) : reunionesDelDia.length === 0 ? (
              <Vacio mensaje="Sin reuniones este día." />
            ) : (
              <div className="divide-y divide-border">
                {reunionesDelDia.map((reunion) => (
                  <FilaReunion key={reunion.id} reunion={reunion} jornada={cap?.jornada_horas}>
                    <Button
                      variante="fantasma"
                      className="h-7 px-2 text-[11px]"
                      disabled={
                        !asignacion ||
                        !incluyeFecha(
                          asignacion.asignacion_desde,
                          asignacion.asignacion_hasta,
                          reunion.dia,
                        )
                      }
                      title={
                        asignacion &&
                        !incluyeFecha(
                          asignacion.asignacion_desde,
                          asignacion.asignacion_hasta,
                          reunion.dia,
                        )
                          ? "La reunión cae fuera de la vigencia de la asignación seleccionada."
                          : "Pre-llena el registro del día con los datos de la reunión."
                      }
                      onClick={() => registrarDesdeReunion(reunion)}
                    >
                      <Plus className="h-3 w-3" /> Registrar
                    </Button>
                  </FilaReunion>
                ))}
              </div>
            )}
          </Card>

          {diaSeleccionado ? (
            <Card>
              <CardHeader
                titulo="Registros cargados"
                descripcion={`${horasMinutos(registradoDelDia(fechaSeleccionada ?? ""))} en el día`}
              />
              {registrosDelDia.length === 0 ? (
                <Vacio mensaje="Todavía no hay horas registradas este día." />
              ) : (
                <div className="divide-y divide-border">
                  {registrosDelDia.map((registro) => {
                    const estadoRegistro = normalizarEstado(registro.estado_aprobacion);
                    return (
                      <div key={registro.id} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold">
                              {registro.proyecto_codigo} · {registro.actividad ?? "Sin actividad"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {registro.descripcion ?? "—"}
                            </p>
                          </div>
                          <Num className="shrink-0 text-[12px] font-bold">
                            {horasMinutos(registro.horas)}
                          </Num>
                        </div>
                        <div className="mt-2 flex items-end justify-between gap-2">
                          <SustentosDelRegistro registroId={registro.id} />
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge tono={TONO_ESTADO[estadoRegistro]}>
                              {estadoRegistro === "enviado" ? <Lock className="h-3 w-3" /> : null}
                              {ETIQUETA_ESTADO[estadoRegistro]}
                            </Badge>
                            {bloqueaRegistro(registro.estado_aprobacion) ? null : (
                              <Button
                                variante="fantasma"
                                className="h-7 px-2 text-[11px] text-accent"
                                cargando={eliminar.isPending && eliminar.variables === registro.id}
                                onClick={() => eliminar.mutate(registro.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Eliminar
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          titulo="Resumen del mes"
          descripcion={`Compromisos y capacidad personal de ${format(mes, "MMMM yyyy", { locale: es })}.`}
        />
        <div className="grid gap-6 p-4 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h3 className="text-[13px] font-semibold">Compromisos vigentes</h3>
            <div className="mt-3 space-y-2">
              {asignaciones.map((a, indice) => {
                const color = colorProyecto(indice);
                return (
                  <div
                    key={a.asignacion_id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border pb-2 last:border-0"
                  >
                    <span className={cn("h-2.5 w-2.5 rounded-full", color.punto)} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold">
                        <Num>{a.proyecto_codigo}</Num> · {a.proyecto_nombre}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        <Num>
                          {fechaCorta(a.asignacion_desde)} – {fechaCorta(a.asignacion_hasta)}
                        </Num>
                      </p>
                    </div>
                    <div className="text-right text-[10px]">
                      <Num className={cn("font-bold", color.texto)}>{n(a.dedicacion_pct, 0)}%</Num>
                      <br />
                      <Num className="text-muted-foreground">{horasMinutos(a.horas_esperadas)}</Num>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border sm:grid-cols-4">
              <ResumenCifra
                icono={<Clock3 className="h-4 w-4" />}
                etiqueta="Capacidad productiva"
                valor={horasMinutos(cap?.capacidad_productiva)}
              />
              <ResumenCifra
                icono={<Check className="h-4 w-4" />}
                etiqueta="Comprometido"
                valor={horasMinutos(cap?.horas_planificadas)}
                nota={pct(cap?.dedicacion_total_pct, 0)}
              />
              <ResumenCifra
                icono={<Circle className="h-4 w-4" />}
                etiqueta="Sin asignar"
                valor={horasMinutos(cap?.horas_sin_asignar)}
                nota={pct(Math.max(0, 100 - Number(cap?.dedicacion_total_pct ?? 0)), 0)}
              />
              <ResumenCifra
                icono={<CalendarDays className="h-4 w-4" />}
                etiqueta="Registrado"
                valor={horasMinutos(cap?.horas_registradas)}
              />
            </div>
            {Number(cap?.dedicacion_total_pct ?? 0) > 100 ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-warning">
                <AlertTriangle className="h-4 w-4" />
                Tu dedicación total supera el 100%.
              </div>
            ) : null}
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-[11px] text-muted-foreground">
                Total comprometido en {format(mes, "MMMM", { locale: es })}
              </p>
              <p className="mt-1 text-[23px] font-semibold">
                <Num>
                  {horasMinutos(cap?.horas_planificadas)} /{" "}
                  {horasMinutos(cap?.capacidad_productiva)}
                </Num>
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold">Enviar días a aprobación</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Elige los días que ya están completos. Tu jefatura revisa cada día con su evidencia.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variante="secundario"
                onClick={() => setDiasSeleccionados(enviables.map((r) => r.id))}
              >
                Seleccionar todos los sin enviar
              </Button>
              <Button variante="secundario" onClick={seleccionarSemana}>
                Seleccionar la semana
              </Button>
              <Button
                variante="primario"
                disabled={marcados.length === 0}
                onClick={() => {
                  setErrorBD(null);
                  setDialogoEnvio(true);
                }}
              >
                <Send className="h-3.5 w-3.5" />
                Enviar {marcados.length > 0 ? `(${marcados.length})` : ""}
              </Button>
            </div>
          </div>
          {registros.length === 0 ? (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Todavía no tienes días registrados este mes.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="w-8 py-2"></th>
                    <th className="py-2 pr-3">Día</th>
                    <th className="py-2 pr-3">Proyecto</th>
                    <th className="py-2 pr-3 text-right">Horas</th>
                    <th className="py-2 pr-3 text-right">Sustentos</th>
                    <th className="py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => {
                    const estado = normalizarEstado(r.estado_aprobacion);
                    const sustentos = Number(r.sustentos ?? 0);
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="py-2">
                          {estado === "sin_enviar" ? (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${r.fecha} ${r.proyecto_codigo ?? ""}`}
                              checked={diasSeleccionados.includes(r.id)}
                              onChange={(e) =>
                                setDiasSeleccionados((prev) =>
                                  e.target.checked
                                    ? [...prev, r.id]
                                    : prev.filter((x) => x !== r.id),
                                )
                              }
                            />
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">
                          <Num className="font-semibold">{fechaCorta(r.fecha)}</Num>
                        </td>
                        <td className="py-2 pr-3">
                          <Num>{r.proyecto_codigo ?? "—"}</Num> · {r.proyecto_nombre ?? "—"}
                          {estado === "observado" && r.comentario_aprobacion ? (
                            <p className="mt-0.5 text-[11px] text-accent">
                              {r.comentario_aprobacion}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Num>{horasMinutos(r.horas)}</Num>
                        </td>
                        <td
                          className={cn(
                            "py-2 pr-3 text-right",
                            sustentos === 0 && "font-bold text-warning",
                          )}
                        >
                          <Num>{n(sustentos, 0)}</Num>
                        </td>
                        <td className="py-2">
                          <Badge tono={TONO_ESTADO[estado]}>
                            {estado === "enviado" ? <Lock className="h-3 w-3" /> : null}
                            {ETIQUETA_ESTADO[estado]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {dialogoEnvio ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-lg rounded-[8px] bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[15px] font-semibold">
                Enviar <Num>{n(marcados.length, 0)}</Num> días a aprobación
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Se envían a tu jefatura directa, día por día.
              </p>
            </div>
            <div className="space-y-3 px-4 py-4">
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {registrosMarcados.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-[13px]">
                    <span>
                      <Num>{fechaCorta(r.fecha)}</Num> · <Num>{r.proyecto_codigo}</Num>
                    </span>
                    <Num className="font-semibold">{horasMinutos(r.horas)}</Num>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-border pt-2 text-[13px] font-semibold">
                <span>Horas seleccionadas</span>
                <Num>
                  {horasMinutos(registrosMarcados.reduce((s, r) => s + Number(r.horas ?? 0), 0))}
                </Num>
              </div>
              <Aviso tono={marcadosSinEvidencia > 0 ? "alerta" : "neutro"}>
                <Num>{n(marcadosSinEvidencia, 0)}</Num> de <Num>{n(marcados.length, 0)}</Num> días
                van sin evidencia adjunta.
              </Aviso>
              <Aviso tono="acento" titulo="Una vez enviado">
                No podrás modificar esos días hasta que tu jefatura responda.
              </Aviso>
              {errorBD ? (
                <Aviso tono="alerta" titulo="La base respondió">
                  {errorBD}
                </Aviso>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setDialogoEnvio(false)}>
                Cancelar
              </Button>
              <Button
                variante="primario"
                disabled={marcados.length === 0}
                cargando={enviarRegistros.isPending}
                onClick={() => enviarRegistros.mutate(marcados)}
              >
                <Send className="h-3.5 w-3.5" />
                Enviar a aprobación
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function ResumenCifra({
  icono,
  etiqueta,
  valor,
  nota,
}: {
  icono: ReactNode;
  etiqueta: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="min-h-24 bg-surface p-3">
      <span className="text-muted-foreground">{icono}</span>
      <p className="mt-2 text-[10px] font-semibold uppercase text-muted-foreground">{etiqueta}</p>
      <Num className="mt-1 block text-[17px] font-semibold">{valor}</Num>
      {nota ? <Num className="text-[10px] text-muted-foreground">{nota}</Num> : null}
    </div>
  );
}

interface SustentoFila {
  id: string;
  nombre_archivo: string | null;
  tamano_bytes: number | null;
  storage_path: string | null;
  hash_sha256: string | null;
}

function SustentosDelRegistro({ registroId }: { registroId: string }) {
  const q = useQuery({
    queryKey: ["sustentos", registroId],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_sustento")
        .select("id, nombre_archivo, tamano_bytes, storage_path, hash_sha256")
        .eq("registro_id", registroId);
      if (error) throw error;
      return (data ?? []) as SustentoFila[];
    },
  });

  async function descargar(sustento: SustentoFila) {
    if (!sustento.storage_path) return;
    const { data, error } = await sustenta.storage
      .from("sustentos")
      .createSignedUrl(sustento.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error(mensajeDeError(error));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  if ((q.data ?? []).length === 0)
    return <span className="text-[10px] text-muted-foreground">Sin sustento</span>;
  return (
    <ul className="min-w-0 space-y-1">
      {(q.data ?? []).map((s) => (
        <li
          key={s.id}
          className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <button
            type="button"
            className="truncate underline underline-offset-2 hover:text-foreground"
            onClick={() => void descargar(s)}
            title={s.hash_sha256 ? `SHA-256: ${s.hash_sha256}` : undefined}
          >
            {s.nombre_archivo ?? "Sustento"}
          </button>
          {s.tamano_bytes ? (
            <Num className="shrink-0">{Math.round(s.tamano_bytes / 1024)} KB</Num>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
