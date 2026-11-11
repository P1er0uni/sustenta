import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Vacio } from "@/components/ui-kit";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { EmpresaVinculada } from "@/integrations/sustenta/types";
import type { AsignacionPeriodo } from "@/integrations/sustenta/vistas";
import { etiquetaPeriodo, fechaCorta, horasMinutos, n, pct } from "@/lib/formato";

export const Route = createFileRoute("/proyectos/")({
  head: () => ({
    meta: [
      { title: "Proyectos intragrupo — Sustenta" },
      {
        name: "description",
        content:
          "Catálogo de proyectos intragrupo con empresa receptora, vigencia, margen y avance de horas del periodo.",
      },
      { property: "og:title", content: "Proyectos intragrupo — Sustenta" },
      { property: "og:description", content: "Servicios prestados a cada empresa vinculada y su beneficio." },
    ],
  }),
  component: ProyectosPantalla,
});

interface ProyectoFila {
  id: string;
  codigo: string | null;
  nombre: string | null;
  empresa_id: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  margen_pct: number | null;
  estado: string | null;
  descripcion_servicio: string | null;
  beneficio_receptor?: string | null;
}

const FORM_VACIO = {
  codigo: "",
  nombre: "",
  empresa_id: "",
  fecha_inicio: "",
  fecha_fin: "",
  margen_pct: "0",
  estado: "activo",
  descripcion_servicio: "",
  beneficio_receptor: "",
};

function ProyectosPantalla() {
  const qc = useQueryClient();
  const { rol } = useSesion();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();
  const [editando, setEditando] = useState<ProyectoFila | "nuevo" | null>(null);
  const [form, setForm] = useState({ ...FORM_VACIO });
  const [error, setError] = useState<string | null>(null);

  const puedeEditar = rol === "administracion";

  const proyectosQ = useQuery({
    queryKey: ["proyectos"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_proyecto").select("*").order("codigo");
      if (err) throw err;
      return (data ?? []) as unknown as ProyectoFila[];
    },
  });

  const empresasQ = useQuery({
    queryKey: ["empresas"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_empresa_vinculada").select("*");
      if (err) throw err;
      return (data ?? []) as EmpresaVinculada[];
    },
  });

  const asignacionesQ = useQuery({
    queryKey: ["proyectos-asignacion-periodo", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_asignacion_periodo")
        .select("*")
        .eq("periodo_id", periodoId);
      if (err) throw err;
      return (data ?? []) as AsignacionPeriodo[];
    },
  });

  const empresas = empresasQ.data ?? [];
  const empresaPorId = useMemo(() => new Map(empresas.map((e) => [e.id, e])), [empresas]);

  const resumen = useMemo(() => {
    const mapa = new Map<string, { personas: Set<string>; registradas: number; esperadas: number }>();
    for (const a of asignacionesQ.data ?? []) {
      const actual = mapa.get(a.proyecto_id) ?? { personas: new Set<string>(), registradas: 0, esperadas: 0 };
      actual.personas.add(a.colaborador_id);
      actual.registradas += Number(a.horas_registradas ?? 0);
      actual.esperadas += Number(a.horas_esperadas ?? 0);
      mapa.set(a.proyecto_id, actual);
    }
    return mapa;
  }, [asignacionesQ.data]);

  const guardar = useMutation({
    mutationFn: async () => {
      const margen = Number(form.margen_pct);
      if (!Number.isFinite(margen)) throw new Error("El margen debe ser un número; 0% es válido.");
      const fila: Record<string, unknown> = {
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        empresa_id: form.empresa_id || null,
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin: form.fecha_fin || null,
        margen_pct: margen,
        estado: form.estado,
        descripcion_servicio: form.descripcion_servicio.trim() || null,
      };
      fila["beneficio_receptor"] = form.beneficio_receptor.trim() || null;

      if (editando && editando !== "nuevo") {
        const { error: err } = await sustenta.from("hr_proyecto").update(fila).eq("id", editando.id);
        if (err) throw err;
      } else {
        const { error: err } = await sustenta.from("hr_proyecto").insert(fila);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      setError(null);
      setEditando(null);
      toast.success("Proyecto guardado");
      qc.invalidateQueries({ queryKey: ["proyectos"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  function abrir(p: ProyectoFila | "nuevo") {
    setError(null);
    setEditando(p);
    if (p === "nuevo") {
      setForm({ ...FORM_VACIO });
    } else {
      setForm({
        codigo: p.codigo ?? "",
        nombre: p.nombre ?? "",
        empresa_id: p.empresa_id ?? "",
        fecha_inicio: p.fecha_inicio ?? "",
        fecha_fin: p.fecha_fin ?? "",
        margen_pct: p.margen_pct == null ? "0" : String(p.margen_pct),
        estado: p.estado ?? "activo",
        descripcion_servicio: p.descripcion_servicio ?? "",
        beneficio_receptor: p.beneficio_receptor ?? "",
      });
    }
  }

  const proyectos = proyectosQ.data ?? [];

  return (
    <AppShell>
      <PageHeader
        titulo="Proyectos"
        descripcion="Servicios intragrupo prestados a cada empresa vinculada, con su margen y su avance del periodo."
        acciones={[{ label: "Proyectos", contador: proyectos.length }]}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
        {puedeEditar ? (
          <Button variante="primario" onClick={() => abrir("nuevo")}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo proyecto
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
        </div>
      ) : null}

      <Card>
        <CardHeader
          titulo="Catálogo de proyectos"
          descripcion={`Cifras de asignación y horas correspondientes a ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}.`}
        />
        {proyectosQ.isLoading ? (
          <Vacio mensaje="Cargando proyectos…" />
        ) : proyectos.length === 0 ? (
          <Vacio mensaje="No hay proyectos visibles para tu perfil." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Código</th>
                  <th className="px-4 py-2 label-xs">Proyecto</th>
                  <th className="px-4 py-2 label-xs">Empresa receptora</th>
                  <th className="px-4 py-2 label-xs">Vigencia</th>
                  <th className="px-4 py-2 label-xs text-right">Margen</th>
                  <th className="px-4 py-2 label-xs text-right">Asignados</th>
                  <th className="px-4 py-2 label-xs text-right">Horas del periodo</th>
                  <th className="px-4 py-2 label-xs">Estado</th>
                  <th className="px-4 py-2 label-xs text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {proyectos.map((p) => {
                  const r = resumen.get(p.id);
                  const empresa = p.empresa_id ? empresaPorId.get(p.empresa_id) : null;
                  const margen = p.margen_pct == null ? null : Number(p.margen_pct);
                  return (
                    <tr key={p.id} className="border-b border-border align-top last:border-0">
                      <td className="px-4 py-2"><Num>{p.codigo ?? "—"}</Num></td>
                      <td className="px-4 py-2">
                        <p className="font-semibold">{p.nombre ?? "Sin nombre"}</p>
                        {p.descripcion_servicio ? (
                          <p className="mt-0.5 max-w-[38ch] text-[12px] text-muted-foreground">
                            {p.descripcion_servicio}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">{empresa?.razon_social ?? empresa?.nombre ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Num className="text-[12px]">
                          {fechaCorta(p.fecha_inicio)} — {fechaCorta(p.fecha_fin)}
                        </Num>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {margen === 0 ? (
                          <Badge tono="info">a costo puro</Badge>
                        ) : (
                          <Num className="tabular-nums">{pct(margen)}</Num>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          to="/proyectos/asignaciones"
                          search={{ proyecto: p.id }}
                          className="underline underline-offset-2"
                        >
                          <Num className="tabular-nums">{r ? n(r.personas.size, 0) : "0"}</Num>
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r ? (
                          <Num className="tabular-nums">
                            {horasMinutos(r.registradas)} / {horasMinutos(r.esperadas)}
                          </Num>
                        ) : (
                          <span className="text-muted-foreground">Sin asignaciones este mes</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tono={(p.estado ?? "").toLowerCase() === "activo" ? "exito" : "neutro"}>
                          {p.estado ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <Link to="/proyectos/asignaciones" search={{ proyecto: p.id }}>
                            <Button variante="secundario">
                              <Users className="h-3.5 w-3.5" />
                              Asignar colaboradores
                            </Button>
                          </Link>
                          {puedeEditar ? (
                            <Button variante="secundario" onClick={() => abrir(p)}>
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editando ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-8 w-full max-w-2xl rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">
                {editando === "nuevo" ? "Nuevo proyecto" : `Editar ${editando.codigo ?? ""}`}
              </h3>
              <Button variante="fantasma" onClick={() => setEditando(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <Etiqueta>Código</Etiqueta>
                <input className="field num mt-1" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
              </div>
              <div>
                <Etiqueta>Nombre</Etiqueta>
                <input className="field mt-1" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div>
                <Etiqueta>Empresa receptora</Etiqueta>
                <select className="field mt-1" value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })}>
                  <option value="">Selecciona una empresa</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.razon_social ?? e.nombre ?? e.ruc}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Etiqueta>Estado</Etiqueta>
                <select className="field mt-1" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })}>
                  <option value="activo">activo</option>
                  <option value="inactivo">inactivo</option>
                </select>
              </div>
              <div>
                <Etiqueta>Fecha de inicio</Etiqueta>
                <input type="date" className="field num mt-1" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} />
              </div>
              <div>
                <Etiqueta>Fecha de fin</Etiqueta>
                <input type="date" className="field num mt-1" value={form.fecha_fin} onChange={(e) => setForm({ ...form, fecha_fin: e.target.value })} />
              </div>
              <div>
                <Etiqueta>Margen (%)</Etiqueta>
                <input className="field num mt-1" inputMode="decimal" value={form.margen_pct} onChange={(e) => setForm({ ...form, margen_pct: e.target.value })} />
                <p className="mt-1 text-[12px] text-muted-foreground">
                  0% es un valor válido: significa facturación a costo puro.
                </p>
              </div>

              <div className="sm:col-span-2">
                <Aviso tono="info" titulo="Estos dos textos van al expediente de defensa">
                  Se imprimen en la sección de naturaleza del servicio: son lo primero que lee un fiscalizador.
                  Descríbelos en términos del servicio prestado y del beneficio concreto que obtiene la empresa
                  vinculada.
                </Aviso>
              </div>
              <div className="sm:col-span-2">
                <Etiqueta>Descripción del servicio</Etiqueta>
                <textarea
                  className="field mt-1 min-h-[90px]"
                  value={form.descripcion_servicio}
                  onChange={(e) => setForm({ ...form, descripcion_servicio: e.target.value })}
                  placeholder="Qué se presta"
                />
              </div>
              <div className="sm:col-span-2">
                <Etiqueta>Beneficio para la empresa receptora</Etiqueta>
                <textarea
                  className="field mt-1 min-h-[90px]"
                  value={form.beneficio_receptor}
                  onChange={(e) => setForm({ ...form, beneficio_receptor: e.target.value })}
                  placeholder="Qué obtiene la vinculada"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button variante="primario" cargando={guardar.isPending} onClick={() => guardar.mutate()}>
                Guardar proyecto
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
