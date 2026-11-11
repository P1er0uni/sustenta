import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { FeriadoFila } from "@/integrations/sustenta/vistas";
import { esFinDeSemana, etiquetaPeriodo, fechaCorta, n, rangoMes } from "@/lib/formato";

export const Route = createFileRoute("/admin/jornada")({
  head: () => ({
    meta: [
      { title: "Jornada y feriados — Sustenta" },
      { name: "description", content: "Feriados y cálculo de días hábiles que definen la capacidad del mes." },
      { property: "og:title", content: "Jornada y feriados — Sustenta" },
      { property: "og:description", content: "Días hábiles y capacidad base del periodo." },
    ],
  }),
  component: Jornada,
});

const JORNADA = 8;

function Jornada() {
  const qc = useQueryClient();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();
  const [fecha, setFecha] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [alcance, setAlcance] = useState("nacional");
  const [error, setError] = useState<string | null>(null);

  const feriadosQ = useQuery({
    queryKey: ["feriados"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_feriado").select("*").order("fecha");
      if (err) throw err;
      return (data ?? []) as FeriadoFila[];
    },
  });

  const feriados = feriadosQ.data ?? [];

  const resumen = useMemo(() => {
    if (!periodo?.anio || !periodo?.mes) return null;
    const { inicio, fin } = rangoMes(periodo.anio, periodo.mes);
    const dias = Number(fin.slice(8));
    let finesSemana = 0;
    for (let d = 1; d <= dias; d += 1) {
      const iso = `${inicio.slice(0, 8)}${String(d).padStart(2, "0")}`;
      if (esFinDeSemana(iso)) finesSemana += 1;
    }
    const feriadosMes = feriados.filter((f) => f.fecha >= inicio && f.fecha <= fin);
    const feriadosHabiles = feriadosMes.filter((f) => !esFinDeSemana(f.fecha)).length;
    const habiles = dias - finesSemana - feriadosHabiles;
    return { dias, finesSemana, feriadosHabiles, habiles, capacidad: habiles * JORNADA, feriadosMes };
  }, [periodo, feriados]);

  const crear = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta
        .from("hr_feriado")
        .insert({ fecha, descripcion, alcance });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setFecha("");
      setDescripcion("");
      toast.success("Feriado agregado");
      qc.invalidateQueries({ queryKey: ["feriados"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const eliminar = useMutation({
    mutationFn: async (f: string) => {
      const { error: err } = await sustenta.from("hr_feriado").delete().eq("fecha", f);
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      toast.success("Feriado eliminado");
      qc.invalidateQueries({ queryKey: ["feriados"] });
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
        titulo="Jornada y feriados"
        descripcion="Los feriados en día hábil reducen los días laborables y con ello la capacidad base del mes."
      />
      <div className="mb-4">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
      </div>

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">
            {error}
          </Aviso>
        </div>
      ) : null}

      {!resumen ? (
        <Card className="mb-5">
          <Vacio mensaje="Selecciona un periodo para ver el resumen del mes." />
        </Card>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Resumen de {etiquetaPeriodo(periodo?.anio, periodo?.mes)} con jornada completa de {JORNADA} horas.
          </p>
          <KPIGrid>
            <KPI etiqueta="Días del mes" valor={n(resumen.dias, 0)} />
            <KPI etiqueta="Fines de semana" valor={n(resumen.finesSemana, 0)} />
            <KPI
              etiqueta="Feriados en día hábil"
              valor={n(resumen.feriadosHabiles, 0)}
              tono={resumen.feriadosHabiles > 0 ? "advertencia" : "neutro"}
            />
            <KPI
              etiqueta="Días hábiles · capacidad"
              valor={`${n(resumen.habiles, 0)} d`}
              nota={`${n(resumen.capacidad, 0)} h de capacidad para jornada completa`}
            />
          </KPIGrid>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader titulo="Feriados" descripcion="Calendario aplicado al cálculo de capacidad." />
          {feriados.length === 0 ? (
            <Vacio mensaje="No hay feriados cargados." />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Fecha</th>
                  <th className="px-4 py-2 label-xs">Descripción</th>
                  <th className="px-4 py-2 label-xs">Alcance</th>
                  <th className="px-4 py-2 label-xs text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {feriados.map((f) => (
                  <tr key={f.fecha} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Num className="tabular-nums">{fechaCorta(f.fecha)}</Num>
                    </td>
                    <td className="px-4 py-2">{f.descripcion}</td>
                    <td className="px-4 py-2">
                      <Badge tono={esFinDeSemana(f.fecha) ? "neutro" : "acento"}>
                        {esFinDeSemana(f.fecha) ? "fin de semana" : (f.alcance ?? "nacional")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variante="peligro"
                        onClick={() => eliminar.mutate(f.fecha)}
                        cargando={eliminar.isPending && eliminar.variables === f.fecha}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Quitar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader titulo="Agregar feriado" />
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              crear.mutate();
            }}
          >
            <div>
              <label className="label-xs" htmlFor="fecha">Fecha</label>
              <input
                id="fecha"
                type="date"
                required
                className="field mt-1 w-full num"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div>
              <label className="label-xs" htmlFor="desc">Descripción</label>
              <input
                id="desc"
                required
                className="field mt-1 w-full"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Día de la Independencia"
              />
            </div>
            <div>
              <label className="label-xs" htmlFor="alc">Alcance</label>
              <select id="alc" className="field mt-1 w-full" value={alcance} onChange={(e) => setAlcance(e.target.value)}>
                <option value="nacional">nacional</option>
                <option value="regional">regional</option>
                <option value="empresa">empresa</option>
              </select>
            </div>
            <Button type="submit" variante="primario" cargando={crear.isPending} className="w-full justify-center">
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
