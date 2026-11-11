import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { BarraH, KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { CapacidadFila, CumplimientoFila, LiquidacionFila } from "@/integrations/sustenta/vistas";
import { COLORES, etiquetaPeriodo, n, pct, soles } from "@/lib/formato";

export const Route = createFileRoute("/dashboard/cumplimiento")({
  head: () => ({
    meta: [
      { title: "Cumplimiento por empresa — Sustenta" },
      { name: "description", content: "Evidencia documental, horas y expedientes sellados por empresa vinculada." },
      { property: "og:title", content: "Cumplimiento por empresa — Sustenta" },
      { property: "og:description", content: "Completitud de evidencia antes del cierre del periodo." },
    ],
  }),
  component: Cumplimiento,
});

function semaforo(v: number): { tono: "exito" | "alerta" | "neutro"; color: string; texto: string } {
  if (v > 95) return { tono: "exito", color: COLORES.ejecutado, texto: "conforme" };
  if (v >= 90) return { tono: "neutro", color: COLORES.advertencia, texto: "por regularizar" };
  return { tono: "alerta", color: COLORES.alerta, texto: "insuficiente" };
}

function Cumplimiento() {
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();

  const todoQ = useQuery({
    queryKey: ["cumplimiento"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_v_cumplimiento").select("*");
      if (error) throw error;
      return (data ?? []) as CumplimientoFila[];
    },
  });

  const liquidacionQ = useQuery({
    queryKey: ["liquidacion-cumplimiento", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_liquidacion")
        .select("total_facturar")
        .eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as Pick<LiquidacionFila, "total_facturar">[];
    },
  });

  const costosQ = useQuery({
    queryKey: ["costos-cumplimiento", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_v_capacidad")
        .select("costo_cargado")
        .eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as Pick<CapacidadFila, "costo_cargado">[];
    },
  });

  const todas = todoQ.data ?? [];
  const filas = useMemo(
    () => todas.filter((f) => f.periodo_id === periodoId).sort((a, b) => Number(b.horas ?? 0) - Number(a.horas ?? 0)),
    [todas, periodoId],
  );

  const horas = filas.reduce((a, f) => a + Number(f.horas ?? 0), 0);
  const evidenciaGlobal =
    horas > 0
      ? filas.reduce((a, f) => a + (Number(f.pct_con_evidencia ?? 0) * Number(f.horas ?? 0)) / 100, 0) / horas * 100
      : 0;
  const sellados = filas.filter((f) => Number(f.expedientes_sellados ?? 0) > 0).length;
  const costosCargados = (costosQ.data?.length ?? 0) > 0 && (costosQ.data ?? []).every((f) => f.costo_cargado);
  const liquidacionCalculada = costosCargados && (liquidacionQ.data ?? []).some((f) => f.total_facturar != null);
  const importe = liquidacionCalculada
    ? (liquidacionQ.data ?? []).reduce((a, f) => a + Number(f.total_facturar ?? 0), 0)
    : null;
  const maxHoras = Math.max(1, ...filas.map((f) => Number(f.horas ?? 0)));

  const serie = useMemo(() => {
    const mapa = new Map<string, { etiqueta: string; horas: number; ponderado: number }>();
    for (const f of todas) {
      const etiqueta = `${f.anio}-${String(f.mes).padStart(2, "0")}`;
      const actual = mapa.get(f.periodo_id) ?? { etiqueta, horas: 0, ponderado: 0 };
      actual.horas += Number(f.horas ?? 0);
      actual.ponderado += (Number(f.pct_con_evidencia ?? 0) * Number(f.horas ?? 0)) / 100;
      mapa.set(f.periodo_id, actual);
    }
    return [...mapa.values()]
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
      .slice(-6)
      .map((p) => ({ etiqueta: p.etiqueta, evidencia: p.horas > 0 ? (p.ponderado / p.horas) * 100 : 0 }));
  }, [todas]);

  const porRegularizar = filas.filter((f) => Number(f.pct_con_evidencia ?? 0) < 95);

  return (
    <AppShell>
      <PageHeader
        titulo="Cumplimiento por empresa"
        descripcion="Evidencia documental de las horas que se declararán en cada expediente de defensa."
      />
      <div className="mb-4">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
      </div>

      {todoQ.error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(todoQ.error)}</Aviso>
        </div>
      ) : null}

      {todoQ.isLoading ? (
        <Card><Vacio mensaje="Cargando cumplimiento…" /></Card>
      ) : filas.length === 0 ? (
        <Card>
          <Vacio mensaje={`No hay horas registradas por empresa en ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}.`} />
        </Card>
      ) : (
        <>
          <KPIGrid>
            <KPI etiqueta="Horas del periodo" valor={n(horas)} unidad="h" />
            <KPI
              etiqueta="Horas con evidencia"
              valor={pct(evidenciaGlobal)}
              tono={evidenciaGlobal > 95 ? "exito" : evidenciaGlobal >= 90 ? "advertencia" : "alerta"}
            />
            <KPI etiqueta="Importe a facturar" valor={liquidacionCalculada ? soles(importe) : "Sin calcular"} nota={liquidacionCalculada ? undefined : "Liquidación no calculada"} />
            <KPI
              etiqueta="Expedientes confirmados"
              valor={`${n(sellados, 0)} / ${n(filas.length, 0)}`}
              tono={sellados === filas.length ? "exito" : "advertencia"}
            />
          </KPIGrid>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader titulo="Horas por empresa" descripcion="Distribución del tiempo prestado en el periodo." />
              <div className="space-y-4 px-4 py-4">
                {filas.map((f) => (
                  <BarraH
                    key={f.empresa_id}
                    etiqueta={f.empresa ?? "—"}
                    detalle={`${n(f.horas)} h · ${pct(f.pct_cobrable, 0)} cobrable`}
                    valor={Number(f.horas ?? 0)}
                    maximo={maxHoras}
                    color={semaforo(Number(f.pct_con_evidencia ?? 0)).color}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader titulo="Evolución de la evidencia" descripcion="Completitud documental de los últimos periodos." />
              <div className="h-72 px-2 py-3">
                {serie.length < 2 ? (
                  <Vacio mensaje="Se necesita más de un periodo con datos para dibujar la evolución." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={serie}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6E3DE" vertical={false} />
                      <XAxis dataKey="etiqueta" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => pct(v)} />
                      <Line
                        type="monotone"
                        dataKey="evidencia"
                        name="Con evidencia"
                        stroke={COLORES.ejecutado}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              titulo="Detalle por empresa"
              descripcion="Verde sobre 95% de evidencia, ámbar entre 90% y 95%, rojo por debajo de 90%."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2 label-xs">Empresa</th>
                    <th className="px-4 py-2 label-xs text-right">Colaboradores</th>
                    <th className="px-4 py-2 label-xs text-right">Horas</th>
                    <th className="px-4 py-2 label-xs text-right">% cobrable</th>
                    <th className="px-4 py-2 label-xs text-right">% con evidencia</th>
                    <th className="px-4 py-2 label-xs text-right">Expedientes sellados</th>
                    <th className="px-4 py-2 label-xs">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const s = semaforo(Number(f.pct_con_evidencia ?? 0));
                    return (
                      <tr key={f.empresa_id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">{f.empresa}</td>
                        <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.colaboradores, 0)}</Num></td>
                        <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.horas)}</Num></td>
                        <td className="px-4 py-2 text-right"><Num className="tabular-nums">{pct(f.pct_cobrable)}</Num></td>
                        <td className="px-4 py-2 text-right">
                          <Num className="tabular-nums font-semibold" >{pct(f.pct_con_evidencia)}</Num>
                        </td>
                        <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.expedientes_sellados, 0)}</Num></td>
                        <td className="px-4 py-2"><Badge tono={s.tono}>{s.texto}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4">
            {porRegularizar.length === 0 ? (
              <Aviso tono="exito" titulo="Evidencia completa">
                Todas las empresas superan el 95% de horas con evidencia: el expediente puede sellarse sin salvedades.
              </Aviso>
            ) : (
              <Aviso tono="alerta" titulo="Regularizar antes del cierre">
                {porRegularizar.map((f) => `${f.empresa} (${pct(f.pct_con_evidencia)})`).join(", ")}. Las horas sin
                evidencia igual quedan declaradas en el defense file del periodo, así que conviene adjuntar el sustento
                antes de cerrar.
              </Aviso>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
