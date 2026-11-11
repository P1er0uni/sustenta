import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { BarraH, KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { AsignacionPeriodo, CapacidadFila, IncidenciaFila } from "@/integrations/sustenta/vistas";
import { COLORES, etiquetaPeriodo, fechaCorta, horasMinutos, n, pct, rangoMes, soles } from "@/lib/formato";

export const Route = createFileRoute("/horas/capacidad")({
  head: () => ({
    meta: [
      { title: "Mi capacidad — Sustenta" },
      { name: "description", content: "Capacidad disponible, incidencias y consumo por proyecto del colaborador." },
      { property: "og:title", content: "Mi capacidad — Sustenta" },
      { property: "og:description", content: "Capacidad productiva frente a horas registradas." },
    ],
  }),
  component: MiCapacidad,
});

function MiCapacidad() {
  const { colaborador } = useSesion();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();

  const capacidadQ = useQuery({
    queryKey: ["mi-capacidad", periodoId, colaborador?.id],
    enabled: sustentaConfigurado && !!periodoId && !!colaborador?.id,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_v_capacidad")
        .select("*")
        .eq("periodo_id", periodoId)
        .eq("colaborador_id", colaborador!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CapacidadFila | null;
    },
  });

  const asignacionesQ = useQuery({
    queryKey: ["mis-asignaciones-periodo", colaborador?.id, periodoId],
    enabled: sustentaConfigurado && !!colaborador?.id && !!periodoId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_v_asignacion_periodo")
        .select("*")
        .eq("colaborador_id", colaborador!.id)
        .eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as AsignacionPeriodo[];
    },
  });

  const rango = periodo?.anio && periodo?.mes ? rangoMes(periodo.anio, periodo.mes) : null;

  const incidenciasQ = useQuery({
    queryKey: ["mis-incidencias", colaborador?.id, rango?.inicio],
    enabled: sustentaConfigurado && !!colaborador?.id && !!rango,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_incidencia")
        .select("*")
        .eq("colaborador_id", colaborador!.id)
        .lte("fecha_inicio", rango!.fin)
        .gte("fecha_fin", rango!.inicio)
        .order("fecha_inicio");
      if (error) throw error;
      return (data ?? []) as IncidenciaFila[];
    },
  });

  const cap = capacidadQ.data;
  const error = capacidadQ.error ?? asignacionesQ.error ?? incidenciasQ.error;
  const asignaciones = asignacionesQ.data ?? [];
  const incidencias = incidenciasQ.data ?? [];
  const sinAsignar = Number(cap?.horas_sin_asignar ?? 0);
  const dedicacion = Number(cap?.dedicacion_total_pct ?? 0);
  const pctSinAsignar = Math.max(0, 100 - dedicacion);
  const costoEstado = cap?.costo_cargado === false
    ? "Sin cargar"
    : cap?.costo_hora == null
      ? "No calculable"
      : soles(cap.costo_hora, 4);

  return (
    <AppShell>
      <PageHeader
        titulo="Mi capacidad"
        descripcion="Capacidad productiva del mes, incidencias y consumo por proyecto."
      />
      <div className="mb-4">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
      </div>

      {error ? (
        <Aviso tono="alerta" titulo="La base de datos respondió">
          {mensajeDeError(error)}
        </Aviso>
      ) : null}

      {!capacidadQ.isLoading && !cap ? (
        <Card className="mb-5">
          <Vacio
            mensaje={`No hay capacidad calculada para ${etiquetaPeriodo(periodo?.anio, periodo?.mes)} en tu usuario.`}
          />
        </Card>
      ) : (
        <KPIGrid columnas={6}>
          <KPI etiqueta="Capacidad bruta" valor={horasMinutos(cap?.capacidad_bruta)} />
          <KPI
            etiqueta="Incidencias"
            valor={horasMinutos(cap?.horas_incidencia)}
            tono={Number(cap?.horas_incidencia ?? 0) > 0 ? "advertencia" : "neutro"}
          />
          <KPI etiqueta="Capacidad productiva" valor={horasMinutos(cap?.capacidad_productiva)} />
          <KPI
            etiqueta="Planificado en proyectos"
            valor={horasMinutos(cap?.horas_planificadas)}
            nota={`${pct(dedicacion, 0)} de dedicación`}
          />
          <KPI
            etiqueta="Sin asignar"
            valor={horasMinutos(cap?.horas_sin_asignar)}
            nota={pct(pctSinAsignar, 0)}
            tono={sinAsignar > 0 ? "advertencia" : "neutro"}
          />
          <KPI
            etiqueta="Registrado"
            valor={horasMinutos(cap?.horas_registradas)}
            tono="exito"
            nota={
              cap?.capacidad_productiva
                ? `${n((Number(cap.horas_registradas ?? 0) / Number(cap.capacidad_productiva)) * 100)}% de la capacidad productiva`
                : undefined
            }
          />
        </KPIGrid>
      )}

      {cap ? (
        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          {sinAsignar > 0 ? (
            <Aviso tono="alerta" titulo="Capacidad sin asignar">
              {pct(pctSinAsignar, 0)} de tu capacidad no está asignada a ningún proyecto. Planificado y sin asignar suman {horasMinutos(cap.capacidad_productiva)}.
            </Aviso>
          ) : (
            <Aviso tono="exito" titulo="Capacidad completamente asignada">
              Toda tu capacidad productiva está planificada en proyectos.
            </Aviso>
          )}
          <Aviso tono={cap.costo_cargado === false ? "neutro" : cap.costo_hora == null ? "acento" : "info"} titulo="Costo por hora del periodo">
            <Num>{costoEstado}</Num>{cap.costo_cargado === false ? ". Es un pendiente del mes." : ""}
          </Aviso>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader titulo="Consumo por proyecto" descripcion="Horas registradas frente a la dedicación pactada." />
          {asignaciones.length === 0 ? (
            <Vacio mensaje="No tienes asignaciones vigentes registradas." />
          ) : (
            <div className="space-y-4 px-4 py-4">
              {asignaciones.map((a) => {
                const objetivo = Number(a.horas_esperadas ?? 0);
                return (
                  <div key={`${a.proyecto_id}-${a.colaborador_id}-${a.periodo_id}`}>
                    <BarraH
                      etiqueta={`${a.proyecto_codigo ?? ""} · ${a.proyecto_nombre ?? ""}`}
                      detalle={`${horasMinutos(a.horas_registradas)} / ${horasMinutos(objetivo)}`}
                      valor={Number(a.horas_registradas ?? 0)}
                      maximo={objetivo || Number(a.horas_registradas ?? 1)}
                      color={
                        objetivo > 0 && Number(a.horas_registradas ?? 0) > objetivo
                          ? COLORES.advertencia
                          : COLORES.ejecutado
                      }
                    />
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{a.empresa}</span>
                      <span>·</span>
                      <Num>{n(a.dedicacion_pct, 0)}%</Num>
                      <span>dedicación</span>
                      <Badge tono={a.cobrable ? "exito" : "neutro"}>{a.cobrable ? "cobrable" : "no cobrable"}</Badge>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            titulo="Incidencias del mes"
            descripcion="Descuentan capacidad productiva y afectan el costo por hora."
          />
          {incidencias.length === 0 ? (
            <Vacio mensaje="Sin incidencias registradas en este periodo." />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Tipo</th>
                  <th className="px-4 py-2 label-xs">Desde</th>
                  <th className="px-4 py-2 label-xs">Hasta</th>
                  <th className="px-4 py-2 label-xs">Origen</th>
                </tr>
              </thead>
              <tbody>
                {incidencias.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{i.tipo}</td>
                    <td className="px-4 py-2 num tabular-nums">{fechaCorta(i.fecha_inicio)}</td>
                    <td className="px-4 py-2 num tabular-nums">{fechaCorta(i.fecha_fin)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{i.origen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
