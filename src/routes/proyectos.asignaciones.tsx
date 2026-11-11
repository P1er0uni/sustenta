import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Progress, Vacio } from "@/components/ui-kit";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { Asignacion, EmpresaVinculada, Proyecto } from "@/integrations/sustenta/types";
import type { AsignacionPeriodo, CapacidadFila } from "@/integrations/sustenta/vistas";
import { nombreColaborador } from "@/integrations/sustenta/types";
import { etiquetaPeriodo, fechaCorta, horasMinutos, pct } from "@/lib/formato";

interface Busqueda {
  proyecto?: string | undefined;
}

export const Route = createFileRoute("/proyectos/asignaciones")({
  validateSearch: (search: Record<string, unknown>): Busqueda => ({
    proyecto: typeof search["proyecto"] === "string" ? (search["proyecto"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Asigna colaboradores — Sustenta" },
      {
        name: "description",
        content: "Asignaciones de colaboradores por proyecto: dedicación, vigencia, cobrabilidad y capacidad usada.",
      },
      { property: "og:title", content: "Asigna colaboradores — Sustenta" },
      {
        property: "og:description",
        content: "Dedicación, vigencia, cobrabilidad y capacidad usada por colaborador.",
      },
    ],
  }),
  component: Asignaciones,
});

interface ProyectoFila extends Proyecto {
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  margen_pct?: number | null;
}

interface ColaboradorVista {
  id: string;
  nombres: string | null;
  apellidos: string | null;
  perfil: string | null;
  activo: boolean | null;
}

function dedicacionPct(a: Asignacion): number {
  const v = a.dedicacion_pct ?? a.dedicacion ?? 0;
  return Number(v) <= 1 ? Number(v) * 100 : Number(v);
}

const NUEVA_VACIA = {
  colaborador_id: "",
  rol_proyecto: "",
  dedicacion_pct: "100",
  cobrable: true,
  fecha_inicio: "",
  fecha_fin: "",
};

function Asignaciones() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/proyectos/asignaciones" });
  const { proyecto: proyectoBuscado } = Route.useSearch();
  const { rol } = useSesion();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();
  const [editando, setEditando] = useState<Asignacion | null>(null);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ ...NUEVA_VACIA });
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [form, setForm] = useState({
    rol_proyecto: "",
    dedicacion_pct: "100",
    cobrable: true,
    fecha_inicio: "",
    fecha_fin: "",
  });
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [errorBorrado, setErrorBorrado] = useState<{ id: string; mensaje: string } | null>(null);

  const puedeAsignar = rol === "administracion" || rol === "jefatura";

  function abrirEditor(a: Asignacion | null, finSugerido?: string) {
    setErrorEdicion(null);
    setEditando(a);
    if (!a) return;
    setForm({
      rol_proyecto: a.rol_proyecto ?? a.rol ?? "",
      dedicacion_pct: String(dedicacionPct(a)),
      cobrable: a.cobrable !== false,
      fecha_inicio: a.fecha_inicio ?? "",
      fecha_fin: finSugerido ?? a.fecha_fin ?? "",
    });
  }

  const proyectosQ = useQuery({
    queryKey: ["proyectos"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_proyecto").select("*").order("codigo");
      if (error) throw error;
      return (data ?? []) as unknown as ProyectoFila[];
    },
  });

  const empresasQ = useQuery({
    queryKey: ["empresas"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_empresa_vinculada").select("*");
      if (error) throw error;
      return (data ?? []) as EmpresaVinculada[];
    },
  });

  const proyectos = proyectosQ.data ?? [];
  const proyectoActual =
    proyectos.find((p) => p.id === proyectoBuscado) ?? proyectos[0] ?? null;

  // Mantiene la URL compartible aun cuando el parámetro no venía.
  useEffect(() => {
    if (proyectoActual && proyectoActual.id !== proyectoBuscado) {
      navigate({ search: { proyecto: proyectoActual.id }, replace: true });
    }
  }, [proyectoActual, proyectoBuscado, navigate]);

  const empresa = useMemo(
    () => (empresasQ.data ?? []).find((e) => e.id === proyectoActual?.empresa_id) ?? null,
    [empresasQ.data, proyectoActual],
  );

  const asignacionesQ = useQuery({
    queryKey: ["asignaciones-proyecto-periodo", proyectoActual?.id, periodoId],
    enabled: sustentaConfigurado && !!proyectoActual && !!periodoId,
    queryFn: async () => {
      // La vista mensual trae la expectativa y ejecución acotadas al periodo.
      const { data, error } = await sustenta
        .from("hr_v_asignacion_periodo")
        .select("*")
        .eq("proyecto_id", proyectoActual!.id)
        .eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as AsignacionPeriodo[];
    },
  });

  const colaboradoresQ = useQuery({
    queryKey: ["colaboradores-activos"],
    enabled: sustentaConfigurado && puedeAsignar,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_v_colaborador").select("*");
      if (error) throw error;
      return ((data ?? []) as ColaboradorVista[]).filter((c) => c.activo !== false);
    },
  });

  const capacidadQ = useQuery({
    queryKey: ["capacidad-periodo", periodoId],
    enabled: sustentaConfigurado && puedeAsignar && !!periodoId,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_v_capacidad").select("*").eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as CapacidadFila[];
    },
  });

  const dedicacionPorColaborador = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of capacidadQ.data ?? []) m.set(c.colaborador_id, Number(c.dedicacion_total_pct ?? 0));
    return m;
  }, [capacidadQ.data]);

  const detalle = useMemo(() => asignacionesQ.data ?? [], [asignacionesQ.data]);

  const asignaciones = useMemo(
    () =>
      detalle.map((d) => ({
        id: d.asignacion_id,
        proyecto_id: d.proyecto_id,
        colaborador_id: d.colaborador_id,
        rol_proyecto: d.rol_proyecto,
        dedicacion_pct: d.dedicacion_pct,
        fecha_inicio: d.asignacion_desde,
        fecha_fin: d.asignacion_hasta,
        cobrable: d.cobrable,
        colaborador: { id: d.colaborador_id, nombre: d.colaborador, rol: "colaborador" },
      })) as Asignacion[],
    [detalle],
  );

  function primerDiaPeriodo(): string {
    if (!periodo?.anio || !periodo?.mes) return "";
    return `${periodo.anio}-${String(periodo.mes).padStart(2, "0")}-01`;
  }

  function abrirAlta() {
    setErrorAlta(null);
    const inicioProyecto = proyectoActual?.fecha_inicio ?? "";
    const inicioPeriodo = primerDiaPeriodo();
    setNueva({
      ...NUEVA_VACIA,
      fecha_inicio: [inicioProyecto, inicioPeriodo].filter(Boolean).sort().at(-1) ?? "",
      fecha_fin: proyectoActual?.fecha_fin ?? "",
    });
    setCreando(true);
  }

  const libreDe = (id: string) => 100 - (dedicacionPorColaborador.get(id) ?? 0);

  const crear = useMutation({
    mutationFn: async () => {
      if (!nueva.colaborador_id) throw new Error("Elige un colaborador.");
      const { error } = await sustenta.from("hr_asignacion").insert({
        colaborador_id: nueva.colaborador_id,
        proyecto_id: proyectoActual!.id,
        rol_proyecto: nueva.rol_proyecto.trim() || null,
        dedicacion_pct: Number(nueva.dedicacion_pct),
        cobrable: nueva.cobrable,
        fecha_inicio: nueva.fecha_inicio || null,
        fecha_fin: nueva.fecha_fin || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCreando(false);
      setErrorAlta(null);
      toast.success("Colaborador asignado");
      qc.invalidateQueries({ queryKey: ["asignaciones-proyecto-periodo"] });
      qc.invalidateQueries({ queryKey: ["capacidad-periodo"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setErrorAlta(m);
      toast.error(m);
    },
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sustenta.from("hr_asignacion").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      setErrorBorrado(null);
      toast.success("Asignación eliminada");
      qc.invalidateQueries({ queryKey: ["asignaciones-proyecto-periodo"] });
    },
    onError: (e, id) => {
      const msg = mensajeDeError(e);
      setErrorBorrado({ id, mensaje: msg });
      toast.error(msg);
    },
  });

  const actualizar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sustenta
        .from("hr_asignacion")
        .update({
          rol_proyecto: form.rol_proyecto.trim() || null,
          dedicacion_pct: Number(form.dedicacion_pct),
          cobrable: form.cobrable,
          fecha_inicio: form.fecha_inicio || null,
          fecha_fin: form.fecha_fin || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asignación actualizada");
      setEditando(null);
      setErrorEdicion(null);
      setErrorBorrado(null);
      qc.invalidateQueries({ queryKey: ["asignaciones-proyecto-periodo"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setErrorEdicion(m);
      toast.error(m);
    },
  });

  const colaboradorElegido = (colaboradoresQ.data ?? []).find((c) => c.id === nueva.colaborador_id) ?? null;
  const totalProyectado = colaboradorElegido
    ? (dedicacionPorColaborador.get(colaboradorElegido.id) ?? 0) + Number(nueva.dedicacion_pct || 0)
    : 0;

  return (
    <AppShell>
      <PageHeader
        titulo="Asigna colaboradores"
        descripcion="Quién participa en el proyecto, con qué dedicación y desde cuándo."
        acciones={[
          { label: "Asignaciones activas", contador: asignaciones.length },
          { label: "Proyectos", to: "/proyectos" },
        ]}
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
        <div className="flex items-center gap-2">
          <span className="label-xs">Proyecto</span>
          <select
            className="field w-72"
            value={proyectoActual?.id ?? ""}
            onChange={(e) => navigate({ search: { proyecto: e.target.value } })}
            aria-label="Proyecto"
          >
            {proyectos.length === 0 ? <option value="">Sin proyectos</option> : null}
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} · ` : ""}
                {p.nombre ?? p.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        {puedeAsignar && proyectoActual ? (
          <Button variante="primario" onClick={abrirAlta}>
            <UserPlus className="h-3.5 w-3.5" />
            Asignar colaborador
          </Button>
        ) : null}
      </div>

      <p className="mb-4 text-[12px] text-muted-foreground">
        {proyectoActual ? (
          <>
            Empresa receptora: {empresa?.razon_social ?? empresa?.nombre ?? "—"} · Vigencia{" "}
            {fechaCorta(proyectoActual.fecha_inicio)} — {fechaCorta(proyectoActual.fecha_fin)} · Margen{" "}
            {Number(proyectoActual.margen_pct ?? 0) === 0 ? "a costo puro" : pct(proyectoActual.margen_pct)}
          </>
        ) : (
          "Sin proyecto seleccionado."
        )}
      </p>

      <Card>
        <CardHeader
          titulo="Asignaciones del proyecto"
          descripcion="La capacidad usada compara horas registradas contra la dedicación comprometida."
        />

        {asignaciones.length === 0 ? (
          <div className="p-6 text-center">
            <Vacio
              mensaje={`Este proyecto no tiene colaboradores asignados en ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}`}
            />
            {puedeAsignar && proyectoActual ? (
              <div className="mt-3 flex justify-center">
                <Button variante="primario" onClick={abrirAlta}>
                  <UserPlus className="h-3.5 w-3.5" />
                  Asignar colaborador
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {["Colaborador", "Rol", "Dedicación", "Vigencia", "Cobrabilidad", "Capacidad usada", "Acciones"].map((h, i) => (
                  <th key={`${h}-${i}`} className="label-xs px-4 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {asignaciones.map((a) => {
                const ded = dedicacionPct(a);
                const filaPeriodo = detalle.find((d) => d.asignacion_id === a.id);
                const usadas = Number(filaPeriodo?.horas_registradas ?? 0);
                const capacidad = Number(filaPeriodo?.horas_esperadas ?? 0);
                const avance = capacidad > 0 ? Math.round((usadas / capacidad) * 100) : 0;
                const cobra = a.cobrabilidad ?? (a.cobrable == null ? null : a.cobrable ? "Cobrable" : "No cobrable");
                return (
                  <tr key={a.id} className="border-b border-border last:border-0 align-middle">
                    <td className="px-4 py-3 font-medium">{nombreColaborador(a.colaborador)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.rol_proyecto ?? a.rol ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Num>{ded.toFixed(0)}%</Num>
                    </td>
                    <td className="px-4 py-3">
                      <Num className="text-[12px]">
                        {a.fecha_inicio ?? "—"} → {a.fecha_fin ?? "sin fin"}
                      </Num>
                    </td>
                    <td className="px-4 py-3">
                      {cobra ? <Badge tono={a.cobrable === false ? "neutro" : "exito"}>{cobra}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-36">
                        <div className="mb-1 flex justify-between">
                          <Num className="text-[12px]">{horasMinutos(usadas)} / {horasMinutos(capacidad)}</Num>
                          <Num className="text-[12px] text-muted-foreground">{avance}%</Num>
                        </div>
                        <Progress valor={avance} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variante="fantasma"
                          aria-label="Editar"
                          onClick={() => abrirEditor(a)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variante="peligro"
                          aria-label="Eliminar"
                          cargando={eliminar.isPending && eliminar.variables === a.id}
                          onClick={() => eliminar.mutate(a.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {errorBorrado ? (
        <div className="mt-4">
          <Aviso tono="acento" titulo="No se pudo eliminar la asignación">
            <p className="mt-1">{errorBorrado.mensaje}</p>
            <div className="mt-2">
              <Button
                variante="primario"
                onClick={() => {
                  const a = asignaciones.find((x) => x.id === errorBorrado.id) ?? null;
                  abrirEditor(a, new Date().toISOString().slice(0, 10));
                }}
              >
                Cerrar anticipadamente
              </Button>
            </div>
          </Aviso>
        </div>
      ) : null}

      {creando ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 px-4 py-8">
          <Card className="w-full max-w-lg">
            <CardHeader
              titulo="Asignar colaborador"
              descripcion={proyectoActual?.nombre ?? ""}
              accion={
                <Button variante="fantasma" onClick={() => setCreando(false)} aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </Button>
              }
            />
            <div className="space-y-4 p-4">
              <div>
                <Etiqueta>Colaborador</Etiqueta>
                <select
                  className="field mt-1 w-full"
                  value={nueva.colaborador_id}
                  onChange={(e) => {
                    const c = (colaboradoresQ.data ?? []).find((x) => x.id === e.target.value);
                    setNueva({
                      ...nueva,
                      colaborador_id: e.target.value,
                      rol_proyecto: nueva.rol_proyecto || (c?.perfil ?? ""),
                    });
                  }}
                >
                  <option value="">Selecciona un colaborador</option>
                  {(colaboradoresQ.data ?? []).map((c) => {
                    const usado = dedicacionPorColaborador.get(c.id) ?? 0;
                    const libre = Math.max(0, 100 - usado);
                    const nombre = [c.nombres, c.apellidos].filter(Boolean).join(" ");
                    return (
                      <option key={c.id} value={c.id}>
                        {nombre} · {c.perfil ?? "sin perfil"} · {usado.toFixed(0)}% asignado,{" "}
                        {libre === 0 ? "sin capacidad libre" : `${libre.toFixed(0)}% libre`}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Etiqueta>Rol en el proyecto</Etiqueta>
                  <input
                    className="field mt-1 w-full"
                    value={nueva.rol_proyecto}
                    onChange={(e) => setNueva({ ...nueva, rol_proyecto: e.target.value })}
                  />
                </div>
                <div>
                  <Etiqueta>Dedicación (%)</Etiqueta>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="field num mt-1 w-full"
                    value={nueva.dedicacion_pct}
                    onChange={(e) => setNueva({ ...nueva, dedicacion_pct: e.target.value })}
                  />
                </div>
                <div>
                  <Etiqueta>Cobrabilidad</Etiqueta>
                  <select
                    className="field mt-1 w-full"
                    value={nueva.cobrable ? "si" : "no"}
                    onChange={(e) => setNueva({ ...nueva, cobrable: e.target.value === "si" })}
                  >
                    <option value="si">Cobrable</option>
                    <option value="no">No cobrable</option>
                  </select>
                </div>
                <div />
                <div>
                  <Etiqueta>Fecha de inicio</Etiqueta>
                  <input
                    type="date"
                    className="field num mt-1 w-full"
                    value={nueva.fecha_inicio}
                    onChange={(e) => setNueva({ ...nueva, fecha_inicio: e.target.value })}
                  />
                </div>
                <div>
                  <Etiqueta>Fecha de fin</Etiqueta>
                  <input
                    type="date"
                    className="field num mt-1 w-full"
                    value={nueva.fecha_fin}
                    onChange={(e) => setNueva({ ...nueva, fecha_fin: e.target.value })}
                  />
                </div>
              </div>

              {colaboradorElegido && Number(nueva.dedicacion_pct || 0) > libreDe(colaboradorElegido.id) ? (
                <Aviso tono="acento" titulo="Sobreasignación">
                  Este colaborador quedaría al {totalProyectado.toFixed(0)}%. Puedes continuar: la decisión es de
                  jefatura y el tablero de capacidad lo mostrará.
                </Aviso>
              ) : null}

              {errorAlta ? <Aviso tono="alerta" titulo="La base de datos respondió">{errorAlta}</Aviso> : null}

              <div className="flex justify-end gap-2">
                <Button variante="secundario" onClick={() => setCreando(false)}>
                  Cancelar
                </Button>
                <Button variante="primario" cargando={crear.isPending} onClick={() => crear.mutate()}>
                  Asignar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {editando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <Card className="w-full max-w-md">
            <CardHeader
              titulo="Editar asignación"
              descripcion={nombreColaborador(editando.colaborador)}
              accion={
                <Button variante="fantasma" onClick={() => setEditando(null)} aria-label="Cerrar">
                  <X className="h-4 w-4" />
                </Button>
              }
            />
            <div className="space-y-4 p-4">
              <div>
                <Etiqueta>Rol en el proyecto</Etiqueta>
                <input
                  className="field mt-1 w-full"
                  value={form.rol_proyecto}
                  onChange={(e) => setForm({ ...form, rol_proyecto: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Etiqueta>Dedicación (%)</Etiqueta>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="field num mt-1 w-full"
                    value={form.dedicacion_pct}
                    onChange={(e) => setForm({ ...form, dedicacion_pct: e.target.value })}
                  />
                </div>
                <div>
                  <Etiqueta>Cobrabilidad</Etiqueta>
                  <select
                    className="field mt-1 w-full"
                    value={form.cobrable ? "si" : "no"}
                    onChange={(e) => setForm({ ...form, cobrable: e.target.value === "si" })}
                  >
                    <option value="si">Cobrable</option>
                    <option value="no">No cobrable</option>
                  </select>
                </div>
                <div>
                  <Etiqueta>Fecha de inicio</Etiqueta>
                  <input
                    type="date"
                    className="field num mt-1 w-full"
                    value={form.fecha_inicio}
                    onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })}
                  />
                </div>
                <div>
                  <Etiqueta>Fecha de fin</Etiqueta>
                  <input
                    type="date"
                    className="field num mt-1 w-full"
                    value={form.fecha_fin}
                    onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Cerrar la asignación conserva las horas ya registradas y evita nuevos registros.
              </p>
              {errorEdicion ? <Aviso tono="alerta" titulo="La base de datos respondió">{errorEdicion}</Aviso> : null}
              <div className="flex justify-end gap-2">
                <Button variante="secundario" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
                <Button
                  variante="primario"
                  cargando={actualizar.isPending}
                  onClick={() => actualizar.mutate(editando.id)}
                >
                  Guardar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
