import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Info } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { CapacidadFila, IncidenciaFila } from "@/integrations/sustenta/vistas";
import type { Colaborador } from "@/integrations/sustenta/types";
import { nombreColaborador } from "@/integrations/sustenta/types";
import { etiquetaPeriodo, fechaCorta, n, rangoMes } from "@/lib/formato";

export const Route = createFileRoute("/admin/incidencias")({
  head: () => ({
    meta: [
      { title: "Incidencias del personal — Sustenta" },
      { name: "description", content: "Vacaciones, licencias y permisos que reducen la capacidad productiva del mes." },
      { property: "og:title", content: "Incidencias del personal — Sustenta" },
      { property: "og:description", content: "Incidencias que afectan el divisor del costo por hora." },
    ],
  }),
  component: Incidencias,
});

function Incidencias() {
  const qc = useQueryClient();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();
  const [colaboradorId, setColaboradorId] = useState("");
  const [tipo, setTipo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rango = periodo?.anio && periodo?.mes ? rangoMes(periodo.anio, periodo.mes) : null;

  const colaboradoresQ = useQuery({
    queryKey: ["colaboradores"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_colaborador").select("*").order("apellidos");
      if (err) throw err;
      return (data ?? []) as Colaborador[];
    },
  });

  const incidenciasQ = useQuery({
    queryKey: ["incidencias", rango?.inicio],
    enabled: sustentaConfigurado && !!rango,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_incidencia")
        .select("*")
        .lte("fecha_inicio", rango!.fin)
        .gte("fecha_fin", rango!.inicio)
        .order("fecha_inicio");
      if (err) throw err;
      return (data ?? []) as IncidenciaFila[];
    },
  });

  const capacidadQ = useQuery({
    queryKey: ["capacidad-incidencias", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_capacidad")
        .select("colaborador_id, horas_incidencia")
        .eq("periodo_id", periodoId);
      if (err) throw err;
      return (data ?? []) as Pick<CapacidadFila, "colaborador_id" | "horas_incidencia">[];
    },
  });

  const colaboradores = colaboradoresQ.data ?? [];
  const incidencias = incidenciasQ.data ?? [];
  const mapaColab = useMemo(
    () => new Map(colaboradores.map((c) => [c.id, nombreColaborador(c)])),
    [colaboradores],
  );
  const horasNoProductivas = (capacidadQ.data ?? []).reduce(
    (acc, f) => acc + Number(f.horas_incidencia ?? 0),
    0,
  );

  const crear = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta.from("hr_incidencia").insert({
        colaborador_id: colaboradorId,
        tipo,
        fecha_inicio: desde,
        fecha_fin: hasta || desde,
        origen: "manual",
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setTipo("");
      setDesde("");
      setHasta("");
      toast.success("Incidencia registrada");
      qc.invalidateQueries({ queryKey: ["incidencias"] });
      qc.invalidateQueries({ queryKey: ["capacidad-incidencias"] });
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
        titulo="Incidencias del personal"
        descripcion="Vacaciones, licencias y permisos del mes por colaborador."
      />
      <div className="mb-4">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
      </div>

      <div className="mb-4">
        <Aviso tono="info" titulo="Por qué son bloqueantes para el cierre">
          <span className="inline-flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Las incidencias restan horas a la capacidad productiva, que es el divisor del costo por hora. Si faltan
            incidencias, el costo por hora sale más bajo de lo real y la liquidación queda mal sustentada.
          </span>
        </Aviso>
      </div>

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">
            {error}
          </Aviso>
        </div>
      ) : null}

      <KPIGrid columnas={2}>
        <KPI etiqueta="Incidencias del mes" valor={n(incidencias.length, 0)} nota={etiquetaPeriodo(periodo?.anio, periodo?.mes)} />
        <KPI
          etiqueta="Horas no productivas"
          valor={n(horasNoProductivas)}
          unidad="h"
          tono={horasNoProductivas > 0 ? "advertencia" : "neutro"}
          nota="Descontadas de la capacidad bruta del periodo"
        />
      </KPIGrid>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader titulo="Incidencias del periodo" />
          {incidencias.length === 0 ? (
            <Vacio mensaje={`Sin incidencias registradas en ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}.`} />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Colaborador</th>
                  <th className="px-4 py-2 label-xs">Tipo</th>
                  <th className="px-4 py-2 label-xs">Desde</th>
                  <th className="px-4 py-2 label-xs">Hasta</th>
                  <th className="px-4 py-2 label-xs">Origen</th>
                </tr>
              </thead>
              <tbody>
                {incidencias.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{mapaColab.get(i.colaborador_id) ?? "—"}</td>
                    <td className="px-4 py-2">{i.tipo}</td>
                    <td className="px-4 py-2"><Num className="tabular-nums">{fechaCorta(i.fecha_inicio)}</Num></td>
                    <td className="px-4 py-2"><Num className="tabular-nums">{fechaCorta(i.fecha_fin)}</Num></td>
                    <td className="px-4 py-2">
                      <Badge tono={i.origen === "manual" ? "acento" : "neutro"}>{i.origen}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader titulo="Registrar incidencia" />
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              crear.mutate();
            }}
          >
            <div>
              <label className="label-xs" htmlFor="colab">Colaborador</label>
              <select
                id="colab"
                required
                className="field mt-1 w-full"
                value={colaboradorId}
                onChange={(e) => setColaboradorId(e.target.value)}
              >
                <option value="">Selecciona…</option>
                {colaboradores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombreColaborador(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs" htmlFor="tipo">Tipo</label>
              <input
                id="tipo"
                required
                className="field mt-1 w-full"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                placeholder="Vacaciones, licencia médica…"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-xs" htmlFor="d1">Desde</label>
                <input id="d1" type="date" required className="field mt-1 w-full num" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div>
                <label className="label-xs" htmlFor="d2">Hasta</label>
                <input id="d2" type="date" className="field mt-1 w-full num" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </div>
            <Button type="submit" variante="primario" cargando={crear.isPending} className="w-full justify-center">
              <Plus className="h-3.5 w-3.5" />
              Registrar
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
