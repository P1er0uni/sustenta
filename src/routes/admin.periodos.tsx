import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, CheckCircle2, Info, Lock, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { Periodo } from "@/integrations/sustenta/types";
import type { ChecklistItem, RegistroDetalle } from "@/integrations/sustenta/vistas";
import { cn } from "@/lib/utils";
import { codigoPeriodo, etiquetaPeriodo, n } from "@/lib/formato";

export const Route = createFileRoute("/admin/periodos")({
  head: () => ({
    meta: [
      { title: "Periodos — Sustenta" },
      { name: "description", content: "Checklist de cierre y sellado de periodos contables." },
      { property: "og:title", content: "Periodos — Sustenta" },
      { property: "og:description", content: "Checklist de cierre con bloqueantes e informativos." },
    ],
  }),
  component: Periodos,
});

function Periodos() {
  const qc = useQueryClient();
  const { periodos, periodoActivo, colaborador } = useSesion();
  const [seleccionado, setSeleccionado] = useState("");
  const [dialogo, setDialogo] = useState(false);
  const [observacion, setObservacion] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hoy = new Date();
  const [apertura, setApertura] = useState(false);
  const [anioNuevo, setAnioNuevo] = useState(String(hoy.getFullYear()));
  const [mesNuevo, setMesNuevo] = useState(String(hoy.getMonth() + 1));
  const [reabriendo, setReabriendo] = useState<Periodo | null>(null);
  const [motivo, setMotivo] = useState("");
  const [resultadoReapertura, setResultadoReapertura] = useState<string | null>(null);

  const periodo = periodos.find((p) => p.id === seleccionado) ?? periodoActivo ?? periodos[0] ?? null;
  const periodoId = periodo?.id ?? "";

  const registrosQ = useQuery({
    queryKey: ["registros-por-periodo"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_registro_detalle")
        .select("periodo_id, horas");
      if (err) throw err;
      return (data ?? []) as Pick<RegistroDetalle, "periodo_id" | "horas">[];
    },
  });

  const resumen = useMemo(() => {
    const mapa = new Map<string, { registros: number; horas: number }>();
    for (const r of registrosQ.data ?? []) {
      const actual = mapa.get(r.periodo_id) ?? { registros: 0, horas: 0 };
      actual.registros += 1;
      actual.horas += Number(r.horas ?? 0);
      mapa.set(r.periodo_id, actual);
    }
    return mapa;
  }, [registrosQ.data]);

  const checklistQ = useQuery({
    queryKey: ["checklist", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error: err } = await sustenta.rpc("hr_checklist_cierre", { p_periodo: periodoId });
      if (err) throw err;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const checklist = checklistQ.data ?? [];
  const bloqueantes = checklist.filter((c) => c.tipo === "bloqueante");
  const informativos = checklist.filter((c) => c.tipo !== "bloqueante");
  const bloqueantesIncumplidos = bloqueantes.filter((c) => !c.cumple);
  const cerrado = (periodo?.estado ?? "").toLowerCase() === "cerrado";

  const cerrar = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta.rpc("hr_cerrar_periodo", {
        p_periodo: periodoId,
        p_usuario: colaborador?.id,
        p_observacion: observacion,
      });
      if (err) throw err;
      await sustenta.rpc("hr_evaluar_alertas", { p_periodo: periodoId });
    },
    onSuccess: () => {
      setError(null);
      setDialogo(false);
      setConfirmacion("");
      setObservacion("");
      toast.success("Periodo cerrado");
      qc.invalidateQueries();
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const abrirPeriodo = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta.rpc("hr_abrir_periodo", {
        p_anio: Number(anioNuevo),
        p_mes: Number(mesNuevo),
        p_usuario: colaborador?.id,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setApertura(false);
      toast.success("Periodo aperturado");
      qc.invalidateQueries();
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const reabrir = useMutation({
    mutationFn: async (p: Periodo) => {
      const { data, error: err } = await sustenta.rpc("hr_reabrir_periodo", {
        p_periodo: p.id,
        p_usuario: colaborador?.id,
        p_motivo: motivo,
      });
      if (err) throw err;
      return typeof data === "string" ? data : JSON.stringify(data);
    },
    onSuccess: (texto) => {
      setError(null);
      setReabriendo(null);
      setMotivo("");
      setResultadoReapertura(texto);
      toast.success("Periodo reabierto");
      qc.invalidateQueries();
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const exigirAprobacion = useMutation({
    mutationFn: async (valor: boolean) => {
      const { error: err } = await sustenta
        .from("hr_periodo")
        .update({ exige_aprobacion: valor })
        .eq("id", periodoId);
      if (err) throw err;
      return valor;
    },
    onSuccess: async (valor) => {
      toast.success(valor ? "El cierre exigirá aprobación de jefatura." : "La aprobación pasa a ser informativa.");
      await qc.invalidateQueries({ queryKey: ["periodos"] });
      await qc.invalidateQueries({ queryKey: ["checklist"] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  return (
    <AppShell>
      <PageHeader titulo="Periodos" descripcion="Estado de cada periodo y checklist previo al cierre." />

      <div className="mb-4 flex justify-end">
        <Button variante="primario" onClick={() => { setError(null); setApertura(true); }}>
          <CalendarPlus className="h-3.5 w-3.5" />
          Aperturar periodo
        </Button>
      </div>

      {resultadoReapertura ? (
        <div className="mb-4">
          <Aviso tono="info" titulo="Resultado de la reapertura">{resultadoReapertura}</Aviso>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Card className="self-start">
          <CardHeader titulo="Periodos" descripcion="Selecciona uno para ver su checklist." />
          {periodos.length === 0 ? (
            <Vacio mensaje="No hay periodos creados." />
          ) : (
            <ul>
              {periodos.map((p) => {
                const r = resumen.get(p.id);
                const activo = p.id === periodoId;
                return (
                  <li
                    key={p.id}
                    className={cn(
                      "border-b border-l-2 border-border last:border-b-0",
                      (p.estado ?? "").toLowerCase() === "abierto" ? "border-l-success" : "border-l-transparent",
                      activo && "bg-surface-muted",
                    )}
                  >
                    <button
                      onClick={() => setSeleccionado(p.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-muted"
                    >
                      <div>
                        <p className="text-[13px] font-semibold">
                          <Num>{codigoPeriodo(p.anio, p.mes)}</Num>{" "}
                          <span className="font-normal text-muted-foreground">{etiquetaPeriodo(p.anio, p.mes)}</span>
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {r ? (
                            <>
                              <Num className="tabular-nums">{n(r.registros, 0)}</Num> registros ·{" "}
                              <Num className="tabular-nums">{n(r.horas)}</Num> h
                            </>
                          ) : (
                            "Sin registros"
                          )}
                        </p>
                      </div>
                      <Badge tono={(p.estado ?? "").toLowerCase() === "abierto" ? "exito" : "neutro"}>
                        {p.estado}
                      </Badge>
                    </button>
                    {(p.estado ?? "").toLowerCase() === "cerrado" ? (
                      <div className="px-4 pb-3">
                        <Button
                          variante="secundario"
                          onClick={() => {
                            setError(null);
                            setMotivo("");
                            setReabriendo(p);
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reabrir
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            titulo={`Checklist de cierre · ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}`}
            descripcion="Los bloqueantes impiden el cierre; los informativos se declaran en la observación."
            accion={
              <div className="flex flex-col items-end gap-1">
                <Button
                  variante="primario"
                  disabled={cerrado || bloqueantesIncumplidos.length > 0 || checklist.length === 0}
                  onClick={() => setDialogo(true)}
                >
                  <Lock className="h-3.5 w-3.5" />
                  {cerrado ? "Periodo cerrado" : "Cerrar periodo"}
                </Button>
                {!cerrado && bloqueantesIncumplidos.length > 0 ? (
                  <span className="text-right text-[11px] text-accent">
                    No se puede cerrar: <Num>{bloqueantesIncumplidos.length}</Num>{" "}
                    {bloqueantesIncumplidos.length === 1 ? "bloqueante pendiente" : "bloqueantes pendientes"}
                  </span>
                ) : null}
              </div>
            }
          />
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Exigir aprobación de jefatura</p>
              <p className="mt-0.5 max-w-xl text-[11px] text-muted-foreground">
                Si se activa, el periodo no podrá cerrarse hasta que todas las horas estén aprobadas por la jefatura.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={!!periodo?.exige_aprobacion}
                disabled={!periodo || cerrado || exigirAprobacion.isPending}
                onChange={(e) => exigirAprobacion.mutate(e.target.checked)}
              />
              {periodo?.exige_aprobacion ? "Bloqueante" : "Informativo"}
            </label>
          </div>
          {checklistQ.isLoading ? (
            <Vacio mensaje="Evaluando checklist…" />
          ) : checklist.length === 0 ? (
            <Vacio mensaje="Este periodo no devolvió items de checklist." />
          ) : (
            <div className="space-y-5 px-4 py-4">
              <ItemsChecklist titulo="Bloqueantes" items={bloqueantes} bloqueante />
              <ItemsChecklist titulo="Informativos" items={informativos} />
            </div>
          )}
          {periodo?.observacion ? (
            <div className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
              <span className="label-xs">Observación del cierre</span>
              <p className="mt-1 text-[13px] text-foreground">{periodo.observacion}</p>
            </div>
          ) : null}
        </Card>
      </div>

      {dialogo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-lg rounded-[8px] bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[15px] font-semibold">
                Cerrar {etiquetaPeriodo(periodo?.anio, periodo?.mes)}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                El cierre sella los registros del periodo y habilita la liquidación.
              </p>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div>
                <span className="label-xs">Al cerrar se asume lo siguiente</span>
                <ul className="mt-2 space-y-1.5">
                  {informativos
                    .filter((i) => !i.cumple)
                    .map((i) => (
                      <li key={i.item} className="flex items-start gap-2 text-[13px]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        <span>
                          {i.item}: <span className="text-muted-foreground">{i.detalle}</span>
                        </span>
                      </li>
                    ))}
                  {informativos.filter((i) => !i.cumple).length === 0 ? (
                    <li className="text-[13px] text-muted-foreground">No hay observaciones pendientes.</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <label className="label-xs" htmlFor="obs">Observación del cierre</label>
                <textarea
                  id="obs"
                  className="field mt-1 h-20 w-full"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Motivo o salvedades que quedan declaradas en el expediente."
                />
              </div>
              <div>
                <label className="label-xs" htmlFor="conf">Escribe CERRAR para confirmar</label>
                <input
                  id="conf"
                  className="field mt-1 w-full num"
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                />
              </div>
              {error ? <Aviso tono="alerta">{error}</Aviso> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setDialogo(false)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={confirmacion !== "CERRAR" || observacion.trim().length === 0}
                cargando={cerrar.isPending}
                onClick={() => cerrar.mutate()}
              >
                <Lock className="h-3.5 w-3.5" />
                Cerrar periodo
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {apertura ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-md rounded-[8px] bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[15px] font-semibold">Aperturar periodo</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Solo se admite el mes en curso o el siguiente, y el periodo anterior debe estar cerrado.
              </p>
            </div>
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              <div>
                <label className="label-xs" htmlFor="anio">Año</label>
                <input
                  id="anio"
                  className="field num mt-1 w-full"
                  inputMode="numeric"
                  value={anioNuevo}
                  onChange={(e) => setAnioNuevo(e.target.value)}
                />
              </div>
              <div>
                <label className="label-xs" htmlFor="mes">Mes</label>
                <select id="mes" className="field mt-1 w-full" value={mesNuevo} onChange={(e) => setMesNuevo(e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={String(m)}>
                      {etiquetaPeriodo(Number(anioNuevo), m)}
                    </option>
                  ))}
                </select>
              </div>
              {error ? (
                <div className="sm:col-span-2">
                  <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setApertura(false)}>Cancelar</Button>
              <Button variante="primario" cargando={abrirPeriodo.isPending} onClick={() => abrirPeriodo.mutate()}>
                <CalendarPlus className="h-3.5 w-3.5" />
                Aperturar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {reabriendo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-lg rounded-[8px] bg-surface shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-[15px] font-semibold">
                Reabrir {etiquetaPeriodo(reabriendo.anio, reabriendo.mes)}
              </h3>
            </div>
            <div className="space-y-3 px-4 py-4">
              <Aviso tono="alerta" titulo="Consecuencia de reabrir">
                Los expedientes definitivos de este periodo pasarán a estado superado y deberán regenerarse tras el
                nuevo cierre.
              </Aviso>
              <div>
                <label className="label-xs" htmlFor="motivo">Motivo de la reapertura (mínimo 15 caracteres)</label>
                <textarea
                  id="motivo"
                  className="field mt-1 h-24 w-full"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Explica por qué es necesario reabrir un periodo ya sellado."
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <Num>{motivo.trim().length}</Num> / <Num>15</Num> caracteres
                </p>
              </div>
              {error ? <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setReabriendo(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={motivo.trim().length < 15}
                cargando={reabrir.isPending}
                onClick={() => reabrir.mutate(reabriendo)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reabrir periodo
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function ItemsChecklist({
  titulo,
  items,
  bloqueante,
}: {
  titulo: string;
  items: ChecklistItem[];
  bloqueante?: boolean;
}) {
  return (
    <div>
      <p className="label-xs mb-2 flex items-center gap-1.5">
        {bloqueante ? <Lock className="h-3 w-3" /> : <Info className="h-3 w-3" />}
        {titulo}
      </p>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Sin items.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li
              key={i.item}
              className={cn(
                "flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[13px]",
                i.cumple
                  ? "border-border bg-surface"
                  : bloqueante
                    ? "border-accent/20 bg-accent-soft"
                    : "border-warning/20 bg-warning-soft",
              )}
            >
              {i.cumple ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : bloqueante ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              )}
              <span>
                <span className="font-semibold">{i.item}</span>
                <span className="block text-muted-foreground">{i.detalle}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
