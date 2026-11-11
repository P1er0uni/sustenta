import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { BarraH, KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { CapacidadFila } from "@/integrations/sustenta/vistas";
import { COLORES, codigoPeriodo, etiquetaPeriodo, n, pct } from "@/lib/formato";

export const Route = createFileRoute("/dashboard/capacidad")({
  head: () => ({
    meta: [
      { title: "Capacidad del equipo — Sustenta" },
      { name: "description", content: "Capacidad productiva, ejecución y tiempo cobrable del equipo en el periodo." },
      { property: "og:title", content: "Capacidad del equipo — Sustenta" },
      { property: "og:description", content: "Ejecución frente a planificación y capacidad disponible." },
    ],
  }),
  component: CapacidadEquipo,
});

function CapacidadEquipo() {
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();

  const todoQ = useQuery({
    queryKey: ["capacidad-todos"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_v_capacidad").select("*");
      if (error) throw error;
      return (data ?? []) as CapacidadFila[];
    },
  });

  const todas = todoQ.data ?? [];
  const filas = useMemo(() => todas.filter((f) => f.periodo_id === periodoId), [todas, periodoId]);

  const t = filas.reduce(
    (acc, f) => ({
      productiva: acc.productiva + Number(f.capacidad_productiva ?? 0),
      registradas: acc.registradas + Number(f.horas_registradas ?? 0),
      cobrables: acc.cobrables + Number(f.horas_cobrables ?? 0),
      incidencias: acc.incidencias + Number(f.horas_incidencia ?? 0),
      planificadas: acc.planificadas + Number(f.horas_planificadas ?? 0),
      sinAsignar: acc.sinAsignar + Number(f.horas_sin_asignar ?? 0),
    }),
    { productiva: 0, registradas: 0, cobrables: 0, incidencias: 0, planificadas: 0, sinAsignar: 0 },
  );

  const alDia = filas.filter(
    (f) => Number(f.horas_planificadas ?? 0) > 0 && Number(f.horas_registradas ?? 0) >= Number(f.horas_planificadas ?? 0),
  ).length;

  const planificadoPendiente = Math.max(0, t.planificadas - t.registradas);
  const dona = [
    { nombre: "Ejecutado", valor: t.registradas, color: COLORES.ejecutado },
    { nombre: "Incidencias", valor: t.incidencias, color: COLORES.advertencia },
    { nombre: "Planificado sin ejecutar", valor: planificadoPendiente, color: COLORES.alerta },
    { nombre: "Sin asignar", valor: t.sinAsignar, color: COLORES.referencia },
  ].filter((d) => d.valor > 0);

  const serie = useMemo(() => {
    const mapa = new Map<string, { etiqueta: string; orden: string; planificado: number; ejecutado: number }>();
    for (const f of todas) {
      const orden = `${f.anio}-${String(f.mes).padStart(2, "0")}`;
      const actual = mapa.get(f.periodo_id) ?? { etiqueta: orden, orden, planificado: 0, ejecutado: 0 };
      actual.planificado += Number(f.horas_planificadas ?? 0);
      actual.ejecutado += Number(f.horas_registradas ?? 0);
      mapa.set(f.periodo_id, actual);
    }
    return [...mapa.values()].sort((a, b) => a.orden.localeCompare(b.orden)).slice(-6);
  }, [todas]);

  const atencion = filas
    .map((f) => {
      const reg = Number(f.horas_registradas ?? 0);
      const plan = Number(f.horas_planificadas ?? 0);
      const prod = Number(f.capacidad_productiva ?? 0);
      if (f.costo_cargado === false) return { c: f, motivo: "Costo mensual sin cargar: es un pendiente del periodo.", tono: "advertencia" as const };
      if (f.costo_hora == null) return { c: f, motivo: "Costo por hora no calculable: revisa la capacidad productiva.", tono: "alerta" as const };
      if (plan > 0 && reg < plan * 0.9)
        return { c: f, motivo: `Registró ${n(reg)} h de ${n(plan)} h planificadas.`, tono: "advertencia" as const };
      if (prod > 0 && reg > prod)
        return { c: f, motivo: `Registró ${n(reg)} h sobre una capacidad productiva de ${n(prod)} h.`, tono: "alerta" as const };
      if (plan === 0 && reg === 0)
        return { c: f, motivo: "Sin asignaciones ni horas en el periodo.", tono: "advertencia" as const };
      return null;
    })
    .filter((x): x is { c: CapacidadFila; motivo: string; tono: "alerta" | "advertencia" } => x !== null);

  return (
    <AppShell>
      <PageHeader titulo="Capacidad del equipo" descripcion="Ejecución del mes frente a la capacidad disponible." />
      <div className="mb-4">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
      </div>

      {todoQ.error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(todoQ.error)}</Aviso>
        </div>
      ) : null}

      {todoQ.isLoading ? (
        <Card><Vacio mensaje="Cargando capacidad…" /></Card>
      ) : filas.length === 0 ? (
        <Card>
          <Vacio mensaje={`No hay datos de capacidad para ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}.`} />
        </Card>
      ) : (
        <>
          <KPIGrid>
            <KPI etiqueta="Capacidad productiva" valor={n(t.productiva)} unidad="h" grande />
            <KPI
              etiqueta="Horas ejecutadas"
              valor={n(t.registradas)}
              unidad="h"
              grande
              tono="exito"
              nota={t.productiva > 0 ? `${pct((t.registradas / t.productiva) * 100)} de la capacidad` : undefined}
            />
            <KPI
              etiqueta="Tiempo cobrable"
              valor={n(t.cobrables)}
              unidad="h"
              grande
              nota={t.registradas > 0 ? `${pct((t.cobrables / t.registradas) * 100)} de lo ejecutado` : undefined}
            />
            <KPI
              etiqueta="Colaboradores al día"
              valor={`${n(alDia, 0)} / ${n(filas.length, 0)}`}
              grande
              tono={alDia === filas.length ? "exito" : "advertencia"}
            />
          </KPIGrid>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader titulo="Composición del mes" descripcion="Cómo se reparte la capacidad productiva." />
              <div className="h-72 px-2 py-3">
                {dona.length === 0 ? (
                  <Vacio mensaje="Sin horas que componer en este periodo." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={dona} dataKey="valor" nameKey="nombre" innerRadius={60} outerRadius={95} paddingAngle={2}>
                        {dona.map((d) => (
                          <Cell key={d.nombre} fill={d.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${n(v)} h`} />
                      <Legend verticalAlign="bottom" height={36} iconType="square" />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader titulo="Planificado vs. ejecutado" descripcion="Últimos seis periodos con datos." />
              <div className="h-72 px-2 py-3">
                {serie.length === 0 ? (
                  <Vacio mensaje="Aún no hay periodos con datos comparables." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serie}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6E3DE" vertical={false} />
                      <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${n(v)} h`} />
                      <Legend iconType="square" />
                      <Bar dataKey="planificado" name="Planificado" fill={COLORES.referencia} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="ejecutado" name="Ejecutado" fill={COLORES.ejecutado} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader titulo="Uso de capacidad por colaborador" descripcion="Horas registradas sobre capacidad productiva." />
              <div className="space-y-4 px-4 py-4">
                {filas.map((f) => {
                  const prod = Number(f.capacidad_productiva ?? 0);
                  const reg = Number(f.horas_registradas ?? 0);
                  const uso = prod > 0 ? (reg / prod) * 100 : 0;
                  return (
                    <BarraH
                      key={f.colaborador_id}
                      etiqueta={f.colaborador ?? "—"}
                      detalle={`${n(reg)} / ${n(prod)} h · ${pct(uso, 0)}`}
                      valor={reg}
                      maximo={prod || reg}
                      color={uso > 100 ? COLORES.alerta : uso >= 70 ? COLORES.ejecutado : COLORES.advertencia}
                    />
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader titulo="Atención requerida" descripcion="Casos a resolver antes del cierre del periodo." />
              {atencion.length === 0 ? (
                <Vacio mensaje="Nada pendiente: el equipo está al día para el cierre." />
              ) : (
                <ul className="divide-y divide-border">
                  {atencion.map((a) => (
                    <li key={a.c.colaborador_id} className="flex items-start gap-2 px-4 py-3">
                      <AlertTriangle
                        className="mt-0.5 h-4 w-4 shrink-0"
                        style={{ color: a.tono === "alerta" ? COLORES.alerta : COLORES.advertencia }}
                      />
                      <span className="text-[13px]">
                        <span className="font-semibold">{a.c.colaborador}</span>
                        <span className="block text-muted-foreground">{a.motivo}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="mt-4 text-[12px] text-muted-foreground">
            Periodo mostrado: <Num>{codigoPeriodo(periodo?.anio, periodo?.mes)}</Num> ({periodo?.estado}).
          </p>
        </>
      )}
    </AppShell>
  );
}
