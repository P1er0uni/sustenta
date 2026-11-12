import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, FileText, Loader2, MessageSquareWarning, Paperclip, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import { analizarEnvio, leerManifestIA } from "@/lib/analizar";
import { abrirInforme, tokenSesion } from "@/lib/informes-ia";
import type { RegistroDetalle, SustentoVista } from "@/integrations/sustenta/vistas";
import type { Colaborador } from "@/integrations/sustenta/types";
import { ETIQUETA_ESTADO, TONO_ESTADO, normalizarEstado } from "@/lib/aprobacion";
import { codigoPeriodo, etiquetaPeriodo, fechaCorta, horasMinutos, n } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/horas/aprobaciones")({
  head: () => ({
    meta: [
      { title: "Aprobaciones — Sustenta" },
      { name: "description", content: "Bandeja diaria de aprobación de horas con evidencia adjunta." },
      { property: "og:title", content: "Aprobaciones — Sustenta" },
      { property: "og:description", content: "Revisa día por día las horas y la evidencia de tu equipo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Aprobaciones,
});

type Filtro = "enviado" | "aprobado" | "observado" | "todos";

const PESTANAS: { valor: Filtro; label: string }[] = [
  { valor: "enviado", label: "Pendientes" },
  { valor: "aprobado", label: "Aprobados" },
  { valor: "observado", label: "Observados" },
  { valor: "todos", label: "Todos" },
];

function Aprobaciones() {
  const qc = useQueryClient();
  const { colaborador, rol, periodos, periodoActivo } = useSesion();
  const [periodoSel, setPeriodoSel] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("enviado");
  const [filtroColaborador, setFiltroColaborador] = useState("");
  const [filtroProyecto, setFiltroProyecto] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [observando, setObservando] = useState<string[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const periodo = periodos.find((p) => p.id === periodoSel) ?? periodoActivo ?? periodos[0] ?? null;
  const periodoId = periodo?.id ?? "";
  const esAdministracion = rol === "administracion";
  const habilitado = sustentaConfigurado && !!periodoId;

  const equipoQ = useQuery({
    queryKey: ["mi-equipo", colaborador?.id],
    enabled: sustentaConfigurado && !esAdministracion && !!colaborador?.id,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_colaborador")
        .select("id, nombres, apellidos, nombre, email, rol")
        .eq("jefe_id", colaborador?.id ?? "");
      if (err) throw err;
      return (data ?? []) as Colaborador[];
    },
  });

  const registrosQ = useQuery({
    queryKey: ["aprobacion-dias", periodoId],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_registro_detalle")
        .select("*")
        .eq("periodo_id", periodoId)
        .not("estado_aprobacion", "is", null)
        .neq("estado_aprobacion", "sin_enviar")
        .order("fecha");
      if (err) throw err;
      return (data ?? []) as RegistroDetalle[];
    },
  });

  const idsEquipo = useMemo(
    () => new Set((equipoQ.data ?? []).map((c) => c.id)),
    [equipoQ.data],
  );

  const todos = useMemo(() => {
    const base = registrosQ.data ?? [];
    return esAdministracion ? base : base.filter((r) => idsEquipo.has(r.colaborador_id));
  }, [registrosQ.data, esAdministracion, idsEquipo]);

  const colaboradores = useMemo(() => {
    const mapa = new Map<string, string>();
    todos.forEach((r) => mapa.set(r.colaborador_id, r.colaborador ?? "Sin nombre"));
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [todos]);

  const proyectos = useMemo(() => {
    const mapa = new Map<string, string>();
    todos.forEach((r) => mapa.set(r.proyecto_id, `${r.proyecto_codigo ?? ""} · ${r.proyecto_nombre ?? ""}`));
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [todos]);

  const visibles = useMemo(
    () =>
      todos.filter((r) => {
        if (filtro !== "todos" && normalizarEstado(r.estado_aprobacion) !== filtro) return false;
        if (filtroColaborador && r.colaborador_id !== filtroColaborador) return false;
        if (filtroProyecto && r.proyecto_id !== filtroProyecto) return false;
        return true;
      }),
    [todos, filtro, filtroColaborador, filtroProyecto],
  );

  // Un grupo por colaborador + día de trabajo: el informe de envío se genera por día.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { nombre: string; fecha: string; filas: RegistroDetalle[] }>();
    visibles.forEach((r) => {
      const clave = `${r.colaborador_id}|${r.fecha}`;
      const actual =
        mapa.get(clave) ?? { nombre: r.colaborador ?? "Sin nombre", fecha: r.fecha, filas: [] };
      actual.filas.push(r);
      mapa.set(clave, actual);
    });
    return [...mapa.values()].sort(
      (a, b) => a.nombre.localeCompare(b.nombre) || a.fecha.localeCompare(b.fecha),
    );
  }, [visibles]);

  const pendientes = todos.filter((r) => normalizarEstado(r.estado_aprobacion) === "enviado");
  const horasPendientes = pendientes.reduce((s, r) => s + Number(r.horas ?? 0), 0);
  const sinEvidencia = pendientes.filter((r) => Number(r.sustentos ?? 0) === 0).length;
  const aprobados = todos.filter((r) => normalizarEstado(r.estado_aprobacion) === "aprobado").length;

  const seleccionables = visibles
    .filter((r) => normalizarEstado(r.estado_aprobacion) === "enviado")
    .map((r) => r.id);
  const marcadas = seleccion.filter((id) => seleccionables.includes(id));

  async function refrescar() {
    setSeleccion([]);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["aprobacion-dias"] }),
      qc.invalidateQueries({ queryKey: ["alertas"] }),
    ]);
  }

  const resolver = useMutation({
    mutationFn: async (args: { ids: string[]; estado: "aprobado" | "observado"; comentario: string }) => {
      const { data, error: err } = await sustenta.rpc("hr_resolver_registros", {
        p_ids: args.ids,
        p_estado: args.estado,
        p_comentario: args.comentario || null,
      });
      if (err) throw err;
      await sustenta.rpc("hr_evaluar_alertas", { p_periodo: periodoId });
      return typeof data === "string" ? data : `${args.ids.length} días resueltos`;
    },
    onSuccess: async (texto) => {
      setError(null);
      setObservando(null);
      setMotivo("");
      toast.success(texto);
      await refrescar();
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  return (
    <AppShell>
      <PageHeader
        titulo="Aprobaciones"
        descripcion="Cada fila es un día en un proyecto. Abre la evidencia antes de aprobar."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="label-xs" htmlFor="periodo">Periodo</label>
          <select
            id="periodo"
            className="field mt-1"
            value={periodo?.id ?? ""}
            onChange={(e) => {
              setPeriodoSel(e.target.value);
              setSeleccion([]);
            }}
          >
            {periodos.map((p) => (
              <option key={p.id} value={p.id}>
                {codigoPeriodo(p.anio, p.mes)} · {p.estado}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-xs" htmlFor="f-colaborador">Colaborador</label>
          <select id="f-colaborador" className="field mt-1" value={filtroColaborador} onChange={(e) => setFiltroColaborador(e.target.value)}>
            <option value="">Todos</option>
            {colaboradores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="label-xs" htmlFor="f-proyecto">Proyecto</label>
          <select id="f-proyecto" className="field mt-1" value={filtroProyecto} onChange={(e) => setFiltroProyecto(e.target.value)}>
            <option value="">Todos</option>
            {proyectos.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variante="primario"
            disabled={marcadas.length === 0}
            cargando={resolver.isPending && resolver.variables?.estado === "aprobado"}
            onClick={() => resolver.mutate({ ids: marcadas, estado: "aprobado", comentario: "" })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Aprobar seleccionados {marcadas.length > 0 ? `(${marcadas.length})` : ""}
          </Button>
          <Button
            variante="peligro"
            disabled={marcadas.length === 0}
            onClick={() => {
              setError(null);
              setMotivo("");
              setObservando(marcadas);
            }}
          >
            <XCircle className="h-3.5 w-3.5" />
            Observar
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
        </div>
      ) : null}
      {registrosQ.error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(registrosQ.error)}</Aviso>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border sm:grid-cols-4">
        <Indicador etiqueta="Días pendientes" valor={n(pendientes.length, 0)} />
        <Indicador etiqueta="Horas pendientes" valor={horasMinutos(horasPendientes)} />
        <Indicador etiqueta="Pendientes sin evidencia" valor={n(sinEvidencia, 0)} />
        <Indicador etiqueta="Días aprobados del periodo" valor={n(aprobados, 0)} />
      </div>

      <Card>
        <CardHeader
          titulo={`Bandeja · ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}`}
          descripcion={esAdministracion ? "Administración ve todos los días enviados." : "Días enviados por tu equipo directo."}
          accion={
            <div className="flex flex-wrap gap-1">
              {PESTANAS.map((p) => (
                <button
                  key={p.valor}
                  onClick={() => setFiltro(p.valor)}
                  className={cn(
                    "rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold",
                    filtro === p.valor ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-surface-muted",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
        />
        {registrosQ.isLoading ? (
          <Vacio mensaje="Cargando días…" />
        ) : grupos.length === 0 ? (
          <Vacio mensaje="No hay días en este estado." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Proyecto</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Actividad</th>
                  <th className="px-3 py-2 text-right">Horas</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Evidencia</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((grupo) => (
                  <Fragment key={`${grupo.nombre}|${grupo.fecha}`}>
                    <tr className="bg-surface-muted/60">
                      <td colSpan={10} className="px-3 py-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">
                            {grupo.nombre} · <Num>{fechaCorta(grupo.fecha)}</Num> ·{" "}
                            <Num>{n(grupo.filas.length, 0)}</Num> registros ·{" "}
                            <Num>{horasMinutos(grupo.filas.reduce((s, r) => s + Number(r.horas ?? 0), 0))}</Num>
                          </span>
                          <InformeEnvioIA nombre={grupo.nombre} fecha={grupo.fecha} filas={grupo.filas} />
                        </div>
                      </td>
                    </tr>
                    {grupo.filas.map((r) => {
                      const estado = normalizarEstado(r.estado_aprobacion);
                      return (
                        <tr key={r.id} className="border-b border-border align-top">
                          <td className="px-3 py-2">
                            {estado === "enviado" ? (
                              <input
                                type="checkbox"
                                aria-label={`Seleccionar ${r.fecha} ${r.proyecto_codigo ?? ""}`}
                                checked={seleccion.includes(r.id)}
                                onChange={(e) =>
                                  setSeleccion((prev) =>
                                    e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id),
                                  )
                                }
                              />
                            ) : null}
                          </td>
                          <td className="px-3 py-2"><Num className="font-semibold">{fechaCorta(r.fecha)}</Num></td>
                          <td className="px-3 py-2">
                            <Num className="font-semibold">{r.proyecto_codigo ?? "—"}</Num>
                            <p className="text-[11px] text-muted-foreground">{r.proyecto_nombre ?? "—"}</p>
                          </td>
                          <td className="px-3 py-2">{r.empresa ?? "—"}</td>
                          <td className="px-3 py-2">{r.actividad ?? "—"}</td>
                          <td className="px-3 py-2 text-right"><Num>{horasMinutos(r.horas)}</Num></td>
                          <td className="max-w-[320px] whitespace-pre-wrap px-3 py-2 text-muted-foreground">
                            {r.descripcion ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Evidencia registroId={r.id} />
                            <InformeAdjunto fila={r} />
                          </td>
                          <td className="px-3 py-2">
                            <Badge tono={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Badge>
                            {r.comentario_aprobacion ? (
                              <p className="mt-1 max-w-[200px] text-[11px] text-muted-foreground">{r.comentario_aprobacion}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {estado === "enviado" ? (
                              <div className="flex justify-end gap-1">
                                <Button
                                  variante="secundario"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => resolver.mutate({ ids: [r.id], estado: "aprobado", comentario: "" })}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                                </Button>
                                <Button
                                  variante="peligro"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => {
                                    setError(null);
                                    setMotivo("");
                                    setObservando([r.id]);
                                  }}
                                >
                                  <XCircle className="h-3.5 w-3.5" /> Observar
                                </Button>
                              </div>
                            ) : estado === "aprobado" ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variante="peligro"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => {
                                    setError(null);
                                    setMotivo("");
                                    setObservando([r.id]);
                                  }}
                                >
                                  <XCircle className="h-3.5 w-3.5" /> Observar
                                </Button>
                                <span className="text-[11px] text-muted-foreground">
                                  <Num>{fechaCorta(r.resuelto_en?.slice(0, 10))}</Num>
                                </span>
                              </div>
                            ) : (
                              <p className="text-right text-[11px] text-muted-foreground">
                                <Num>{fechaCorta(r.resuelto_en?.slice(0, 10))}</Num>
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {observando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-lg rounded-[8px] bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[15px] font-semibold">Observar días</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <Num>{n(observando.length, 0)}</Num> días seleccionados
              </p>
            </div>
            <div className="space-y-3 px-4 py-4">
              <label className="label-xs" htmlFor="motivo-obs">Motivo de la observación (mínimo 10 caracteres)</label>
              <textarea
                id="motivo-obs"
                className="field mt-1 h-24 w-full"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Explica qué debe corregir el colaborador."
              />
              <p className="text-[11px] text-muted-foreground"><Num>{motivo.trim().length}</Num> / <Num>10</Num></p>
              {error ? <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setObservando(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={motivo.trim().length < 10}
                cargando={resolver.isPending}
                onClick={() => resolver.mutate({ ids: observando, estado: "observado", comentario: motivo.trim() })}
              >
                <MessageSquareWarning className="h-3.5 w-3.5" />
                Observar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function Indicador({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="bg-surface p-3">
      <span className="text-muted-foreground"><Clock3 className="h-4 w-4" /></span>
      <p className="mt-2 text-[10px] font-semibold uppercase text-muted-foreground">{etiqueta}</p>
      <Num className="mt-1 block text-[17px] font-semibold">{valor}</Num>
    </div>
  );
}

/** Demo: informes PDF del agente de sustentos, publicados como archivos estáticos en /informes. */
interface InformeIAEntrada {
  /** "lote" = informe consolidado del envío; ausente = informe individual de un registro. */
  tipo?: string;
  proyecto?: string;
  fecha?: string;
  colaborador: string;
  periodo?: string;
  archivo: string;
  htmlArchivo?: string;
  veredicto: string;
  aprobado?: boolean;
  /** true = informe aprobado guardado como HTML sellado (Vercel): se abre con
   *  botón de imprimir para generarlo como PDF en el navegador. */
  sinPdf?: boolean;
  /** Solo para lote: registros que agrupa el informe consolidado. */
  registros?: { registroId?: string; fecha?: string; proyecto?: string; veredicto?: string }[];
}

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const coincideColaborador = (entrada: string, buscado: string) =>
  sinTildes(entrada).split(/\s+/).every((parte) => sinTildes(buscado).includes(parte));

/**
 * Manifest de informes publicados. staleTime corto para que la bandeja
 * refleje los informes aprobados al volver de la ventana de edición.
 */
function useInformesManifest() {
  return useQuery({
    queryKey: ["informes-ia"],
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<InformeIAEntrada[]> => {
      try {
        // Server fn: local lee public/informes/manifest.json; Vercel lee
        // informes-ia/manifest.json de Storage con los permisos del usuario.
        const datos = await leerManifestIA({ data: { token: await tokenSesion() } });
        return Array.isArray(datos) ? (datos as InformeIAEntrada[]) : [];
      } catch {
        return [];
      }
    },
  });
}

/**
 * Enlace al informe aprobado al que está adjunto este registro
 * (generado por la IA y aprobado por la jefatura desde la ventana de edición).
 */
function InformeAdjunto({ fila }: { fila: RegistroDetalle }) {
  const q = useInformesManifest();
  const [abriendo, setAbriendo] = useState(false);
  const informe = (q.data ?? []).find((i) => {
    if (!i.aprobado) return false;
    if (i.tipo === "lote") return (i.registros ?? []).some((r) => r.registroId === fila.id);
    return (
      i.fecha === fila.fecha &&
      i.proyecto === fila.proyecto_codigo &&
      coincideColaborador(i.colaborador, fila.colaborador ?? "")
    );
  });
  if (!informe) return null;
  // sinPdf (Vercel): el aprobado es HTML sellado → se abre con botón de imprimir.
  const archivo = informe.sinPdf ? (informe.htmlArchivo ?? informe.archivo) : informe.archivo;
  return (
    <button
      type="button"
      disabled={abriendo}
      onClick={() => {
        setAbriendo(true);
        void tokenSesion()
          .then((token) => abrirInforme(archivo, token, !!informe.sinPdf))
          .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
          .finally(() => setAbriendo(false));
      }}
      title={`Informe aprobado adjunto (veredicto: ${informe.veredicto.replace(/_/g, " ")})`}
      className="mt-1.5 inline-flex items-center gap-1 rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-accent disabled:opacity-50"
    >
      <FileText className="h-3 w-3" />
      Informe
    </button>
  );
}

/**
 * Informe consolidado del envío: un solo documento IA con todos los registros
 * que el colaborador envió de un día de trabajo, para que la jefatura no revise
 * fila por fila. Vive en el encabezado del grupo (colaborador + día).
 * Si ya existe un informe del día pero llegaron registros nuevos pendientes,
 * el botón "Generar" reaparece y el nuevo informe cubre todos los pendientes del día.
 */
function InformeEnvioIA({
  nombre,
  fecha,
  filas,
}: {
  nombre: string;
  fecha: string;
  filas: RegistroDetalle[];
}) {
  const qc = useQueryClient();
  const q = useInformesManifest();
  const [abriendo, setAbriendo] = useState(false);

  const enviados = filas.filter((r) => normalizarEstado(r.estado_aprobacion) === "enviado");
  const lote = (q.data ?? []).find(
    (i) => i.tipo === "lote" && i.fecha === fecha && coincideColaborador(i.colaborador, nombre),
  );
  const cubiertos = new Set((lote?.registros ?? []).map((r) => r.registroId));
  const sinCubrir = enviados.filter((r) => !cubiertos.has(r.id));

  const generar = useMutation({
    mutationFn: async () => {
      // Bajar la evidencia de cada registro con URLs firmadas y pasársela al servidor.
      const registros = await Promise.all(
        enviados.map(async (r) => {
          const { data: sustentos, error } = await sustenta
            .from("hr_v_sustento")
            .select("*")
            .eq("registro_id", r.id);
          if (error) throw error;
          const conUrl = await Promise.all(
            (sustentos ?? [])
              .filter((s) => s.storage_path)
              .map(async (s) => {
                const { data: url, error: errUrl } = await sustenta.storage
                  .from("sustentos")
                  .createSignedUrl(s.storage_path!, 300);
                if (errUrl || !url?.signedUrl) throw new Error(mensajeDeError(errUrl));
                return { nombre: s.nombre_archivo ?? "sustento", url: url.signedUrl, hash: s.hash_sha256 };
              }),
          );
          return {
            id: r.id,
            fecha: r.fecha,
            horas: Number(r.horas ?? 0),
            actividad: r.actividad,
            descripcion: r.descripcion,
            proyectoCodigo: r.proyecto_codigo,
            proyectoNombre: r.proyecto_nombre,
            empresa: r.empresa,
            sustentos: conUrl,
          };
        }),
      );
      return analizarEnvio({ data: { colaborador: nombre, registros, token: await tokenSesion() } });
    },
    onSuccess: async (res) => {
      if (res.ok && res.pdfArchivo) {
        toast.success("Informe del envío generado. Abriendo editor…");
        // Redundancia del MaaS: si el modelo primario no estaba disponible y el
        // informe salió con uno de respaldo, se notifica el cambio.
        for (const aviso of res.avisosModelo ?? []) toast.warning(aviso);
        const params = new URLSearchParams({
          tipo: "lote",
          colaborador: nombre,
          fecha,
          htmlArchivo: res.pdfArchivo.replace(/\.pdf$/, ".html"),
          registroIds: enviados.map((r) => r.id).join(","),
        });
        window.open(`/informe/editar?${params.toString()}`, "_blank", "noopener");
      } else {
        toast.error(`El análisis del envío falló: ${res.salida}`);
        console.error("[analizarEnvio]", res.salida);
      }
      await qc.refetchQueries({ queryKey: ["informes-ia"] });
    },
    onError: (e) => {
      toast.error(`No se pudo ejecutar el análisis: ${e instanceof Error ? e.message : String(e)}`);
    },
  });

  if (enviados.length === 0) return null;

  // El informe existente ya cubre todos los pendientes del día → enlace, no botón.
  if (lote && sinCubrir.length === 0 && lote.aprobado) {
    // Estado 3: Informe del envío aprobado → lo abre (PDF local, HTML+imprimir en Vercel)
    const archivo = lote.sinPdf ? (lote.htmlArchivo ?? lote.archivo) : lote.archivo;
    return (
      <button
        type="button"
        disabled={abriendo}
        onClick={() => {
          setAbriendo(true);
          void tokenSesion()
            .then((token) => abrirInforme(archivo, token, !!lote.sinPdf))
            .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
            .finally(() => setAbriendo(false));
        }}
        title={`Informe del envío aprobado (veredicto: ${lote.veredicto.replace(/_/g, " ")})`}
        className="inline-flex items-center gap-1 rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-accent disabled:opacity-50"
      >
        <FileText className="h-3 w-3" />
        Informe del envío
      </button>
    );
  }

  if (lote && sinCubrir.length === 0) {
    // Estado 2: Informe del envío generado → abre el informe para revisarlo
    const params = new URLSearchParams({
      tipo: "lote",
      colaborador: nombre,
      fecha,
      htmlArchivo: lote.htmlArchivo ?? lote.archivo.replace(/\.pdf$/, ".html"),
      registroIds: enviados.map((r) => r.id).join(","),
    });
    return (
      <a
        href={`/informe/editar?${params.toString()}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Informe IA del envío (veredicto: ${lote.veredicto.replace(/_/g, " ")}).`}
        className="inline-flex items-center gap-1 rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-accent"
      >
        <FileText className="h-3 w-3" />
        Informe IA del envío
      </a>
    );
  }

  // Estado 1: Sin informe → generar el consolidado del envío
  return (
    <button
      type="button"
      disabled={generar.isPending}
      onClick={() => generar.mutate()}
      title="Ejecuta el agente de sustentos sobre los registros enviados de este día y genera un único informe consolidado"
      className="inline-flex items-center gap-1 rounded-[4px] border border-[#c22f30] bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground shadow-sm hover:bg-[#c22f30] disabled:opacity-50"
    >
      {generar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {generar.isPending ? "Generando…" : `Generar informe del envío (${n(enviados.length, 0)})`}
    </button>
  );
}

function Evidencia({ registroId }: { registroId: string }) {
  const q = useQuery({
    queryKey: ["sustento-vista", registroId],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_v_sustento").select("*").eq("registro_id", registroId);
      if (error) throw error;
      return (data ?? []) as SustentoVista[];
    },
  });

  async function abrir(s: SustentoVista) {
    if (!s.storage_path) return;
    const { data, error } = await sustenta.storage.from("sustentos").createSignedUrl(s.storage_path, 300);
    if (error || !data?.signedUrl) {
      toast.error(mensajeDeError(error));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  if (q.isLoading) return <span className="text-[11px] text-muted-foreground">…</span>;
  const filas = q.data ?? [];
  if (filas.length === 0) {
    return <span className="rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent">Sin sustento</span>;
  }
  return (
    <ul className="space-y-1">
      {filas.map((s) => (
        <li key={s.id} className="flex items-center gap-1 text-[11px]">
          <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="truncate underline underline-offset-2 hover:text-accent"
            title={s.hash_sha256 ? `SHA-256: ${s.hash_sha256}` : undefined}
            onClick={() => void abrir(s)}
          >
            {s.nombre_archivo ?? "Sustento"}
          </button>
        </li>
      ))}
    </ul>
  );
}
