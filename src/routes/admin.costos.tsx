import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Check, Download, Pencil, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { CapacidadFila } from "@/integrations/sustenta/vistas";
import { cn } from "@/lib/utils";
import { etiquetaPeriodo, n, soles } from "@/lib/formato";

export const Route = createFileRoute("/admin/costos")({
  head: () => ({
    meta: [
      { title: "Costos del personal — Sustenta" },
      { name: "description", content: "Costo mensual, capacidad productiva y costo por hora de cada colaborador." },
      { property: "og:title", content: "Costos del personal — Sustenta" },
      { property: "og:description", content: "Costo por hora calculado sobre la capacidad productiva." },
    ],
  }),
  component: Costos,
});

interface ColaboradorMin {
  id: string;
  documento: string | null;
  nombres: string | null;
  apellidos: string | null;
  activo: boolean | null;
}

interface FilaCsv {
  documento: string;
  costoTexto: string;
  costo: number | null;
  nombre: string | null;
  colaborador_id: string | null;
  estado: "ok" | "sin-colaborador" | "costo-invalido";
}

/** Parsea `documento,costo_mensual` y cruza cada documento con los colaboradores. */
function parsearCsv(texto: string, colaboradores: ColaboradorMin[]): FilaCsv[] {
  const porDocumento = new Map(colaboradores.map((c) => [(c.documento ?? "").trim(), c]));
  const lineas = texto
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lineas.length === 0) return [];
  if (/documento/i.test(lineas[0] ?? "")) lineas.shift();

  return lineas.map((linea) => {
    const celdas = linea.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const documento = celdas[0] ?? "";
    const costoTexto = celdas[1] ?? "";
    const colaborador = porDocumento.get(documento) ?? null;
    const costo = costoTexto === "" ? null : Number(costoTexto.replace(/\s/g, "").replace(/,/g, "."));
    const costoValido = costo != null && Number.isFinite(costo) && costo > 0;
    const estado: FilaCsv["estado"] = !colaborador
      ? "sin-colaborador"
      : costoValido
        ? "ok"
        : "costo-invalido";
    return {
      documento,
      costoTexto,
      costo: costoValido ? costo : null,
      nombre: colaborador ? `${colaborador.nombres ?? ""} ${colaborador.apellidos ?? ""}`.trim() : null,
      colaborador_id: colaborador?.id ?? null,
      estado,
    };
  });
}

/**
 * Costo por hora efectivo de una fila.
 * Usa el valor calculado por la base (hr_calcular_costos) si existe;
 * si no, lo calcula en el cliente como costo_mensual / capacidad_productiva
 * (con fallback a capacidad_bruta) para que se muestre de inmediato aun
 * sin haber corrido el RPC.
 */
function costoHoraCalculado(f: CapacidadFila): number | null {
  if (f.costo_hora != null) return Number(f.costo_hora);
  if (f.costo_mensual == null || f.costo_mensual <= 0) return null;
  const productiva = Number(f.capacidad_productiva ?? 0);
  const bruta = Number(f.capacidad_bruta ?? 0);
  const divisor = productiva > 0 ? productiva : bruta;
  if (divisor <= 0) return null;
  return Number(f.costo_mensual) / divisor;
}

function Costos() {
  const qc = useQueryClient();
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado();
  const [editando, setEditando] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const anterior = useMemo(() => {
    if (!periodo?.anio || !periodo?.mes) return null;
    const mes = periodo.mes === 1 ? 12 : periodo.mes - 1;
    const anio = periodo.mes === 1 ? periodo.anio - 1 : periodo.anio;
    return periodos.find((p) => p.anio === anio && p.mes === mes) ?? null;
  }, [periodo, periodos]);

  const filasQ = useQuery({
    queryKey: ["costos-capacidad", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_capacidad")
        .select("*")
        .eq("periodo_id", periodoId)
        .order("colaborador");
      if (err) throw err;
      return (data ?? []) as CapacidadFila[];
    },
  });

  const previoQ = useQuery({
    queryKey: ["costos-capacidad-previo", anterior?.id],
    enabled: sustentaConfigurado && !!anterior?.id,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_v_capacidad")
        .select("colaborador_id, costo_hora, costo_cargado")
        .eq("periodo_id", anterior!.id);
      if (err) throw err;
      return (data ?? []) as Pick<CapacidadFila, "colaborador_id" | "costo_hora" | "costo_cargado">[];
    },
  });

  const previo = useMemo(
    () => new Map((previoQ.data ?? []).filter((f) => f.costo_cargado && f.costo_hora != null).map((f) => [f.colaborador_id, Number(f.costo_hora)])),
    [previoQ.data],
  );

  const guardar = useMutation({
    mutationFn: async ({ fila, valor }: { fila: CapacidadFila; valor: number }) => {
      const { data: existente, error: errSel } = await sustenta
        .from("hr_costo_mensual")
        .select("id")
        .eq("colaborador_id", fila.colaborador_id)
        .eq("periodo_id", periodoId)
        .maybeSingle();
      if (errSel) throw errSel;
      if (existente?.id) {
        const { error: err } = await sustenta
          .from("hr_costo_mensual")
          .update({ costo_mensual: valor })
          .eq("id", existente.id);
        if (err) throw err;
      } else {
        const { error: err } = await sustenta.from("hr_costo_mensual").insert({
          colaborador_id: fila.colaborador_id,
          periodo_id: periodoId,
          costo_mensual: valor,
          capacidad_horas: Number(fila.capacidad_bruta ?? 0),
          horas_incidencia: Number(fila.horas_incidencia ?? 0),
          horas_productivas: Number(fila.capacidad_productiva ?? 0),
        });
        if (err) throw err;
      }
      // Recalcular el costo por hora en la base tras guardar el mensual,
      // para que no haga falta pulsar "Calcular costos del periodo" aparte.
      const { error: errRpc } = await sustenta.rpc("hr_calcular_costos", { p_periodo: periodoId });
      if (errRpc) throw errRpc;
    },
    onSuccess: () => {
      setError(null);
      setEditando(null);
      toast.success("Costo mensual actualizado y costo por hora recalculado");
      qc.invalidateQueries({ queryKey: ["costos-capacidad"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const calcular = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta.rpc("hr_calcular_costos", { p_periodo: periodoId });
      if (err) throw err;
      await sustenta.rpc("hr_evaluar_alertas", { p_periodo: periodoId });
    },
    onSuccess: () => {
      setError(null);
      toast.success("Costos recalculados");
      qc.invalidateQueries({ queryKey: ["costos-capacidad"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const filas = filasQ.data ?? [];

  // ---- Carga masiva por archivo CSV ----
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [dialogo, setDialogo] = useState(false);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [previsualizacion, setPrevisualizacion] = useState<FilaCsv[]>([]);
  const [aplicado, setAplicado] = useState(false);

  const colaboradoresQ = useQuery({
    queryKey: ["colaboradores-activos"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_colaborador")
        .select("id, documento, nombres, apellidos, activo")
        .eq("activo", true);
      if (err) throw err;
      return (data ?? []) as ColaboradorMin[];
    },
  });
  const colaboradores = colaboradoresQ.data ?? [];

  const conError = previsualizacion.filter((f) => f.estado !== "ok");
  const validas = previsualizacion.filter((f) => f.estado === "ok");
  const documentosEnArchivo = new Set(previsualizacion.map((f) => f.documento));
  const faltantes = colaboradores.filter((c) => !documentosEnArchivo.has((c.documento ?? "").trim()));

  function leerArchivo(file: File) {
    const lector = new FileReader();
    lector.onload = () => {
      const texto = String(lector.result ?? "");
      setNombreArchivo(file.name);
      setPrevisualizacion(parsearCsv(texto, colaboradores));
      setAplicado(false);
      setDialogo(true);
    };
    lector.readAsText(file);
  }

  const cargaMasiva = useMutation({
    mutationFn: async () => {
      const capacidadPorColaborador = new Map(filas.map((f) => [f.colaborador_id, f]));
      for (const fila of validas) {
        const { data: existente, error: errSel } = await sustenta
          .from("hr_costo_mensual")
          .select("id")
          .eq("colaborador_id", fila.colaborador_id!)
          .eq("periodo_id", periodoId)
          .maybeSingle();
        if (errSel) throw errSel;
        if (existente?.id) {
          const { error: err } = await sustenta
            .from("hr_costo_mensual")
            .update({ costo_mensual: fila.costo })
            .eq("id", existente.id);
          if (err) throw err;
        } else {
          const cap = capacidadPorColaborador.get(fila.colaborador_id!);
          const nueva: Record<string, unknown> = {
            colaborador_id: fila.colaborador_id,
            periodo_id: periodoId,
            costo_mensual: fila.costo,
          };
          if (cap) {
            nueva["capacidad_horas"] = Number(cap.capacidad_bruta ?? 0);
            nueva["horas_incidencia"] = Number(cap.horas_incidencia ?? 0);
            nueva["horas_productivas"] = Number(cap.capacidad_productiva ?? 0);
          }
          const { error: err } = await sustenta.from("hr_costo_mensual").insert(nueva);
          if (err) throw err;
        }
      }
      const { error: errRpc } = await sustenta.rpc("hr_calcular_costos", { p_periodo: periodoId });
      if (errRpc) throw errRpc;
      await sustenta.rpc("hr_evaluar_alertas", { p_periodo: periodoId });
    },
    onSuccess: async () => {
      setError(null);
      setAplicado(true);
      toast.success(`${validas.length} costos cargados y recalculados`);
      await qc.invalidateQueries({ queryKey: ["costos-capacidad"] });
      await qc.invalidateQueries({ queryKey: ["alertas"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  function descargarPlantilla() {
    const lineas = ["documento,costo_mensual", ...colaboradores.map((c) => `${c.documento ?? ""},`)];
    const blob = new Blob([`\uFEFF${lineas.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `costos_${periodo?.anio ?? ""}-${String(periodo?.mes ?? "").padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      <PageHeader
        titulo="Costos del personal"
        descripcion="El costo por hora resulta del costo mensual dividido entre la capacidad productiva."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="text-[12px] font-semibold text-info underline underline-offset-2"
            onClick={descargarPlantilla}
            disabled={colaboradores.length === 0}
          >
            <Download className="mr-1 inline h-3.5 w-3.5" />
            Descargar plantilla
          </button>
          <input
            ref={inputArchivo}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) leerArchivo(file);
              e.target.value = "";
            }}
          />
          <Button variante="secundario" onClick={() => inputArchivo.current?.click()} disabled={!periodoId}>
            <Upload className="h-3.5 w-3.5" />
            Cargar archivo
          </Button>
          <Button variante="primario" cargando={calcular.isPending} onClick={() => calcular.mutate()} disabled={!periodoId}>
            <Calculator className="h-3.5 w-3.5" />
            Calcular costos del periodo
          </Button>
        </div>
      </div>

      {dialogo ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-8 w-full max-w-3xl rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Carga de costos por archivo</h3>
                <p className="text-[12px] text-muted-foreground">
                  {nombreArchivo} · {etiquetaPeriodo(periodo?.anio, periodo?.mes)}
                </p>
              </div>
              <Button variante="fantasma" onClick={() => setDialogo(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-4">
              {aplicado ? (
                <>
                  <Aviso tono="exito" titulo="Costos cargados y recalculados">
                    Se aplicaron {validas.length} costos al periodo y la base recalculó el costo por hora.
                  </Aviso>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[860px] text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="px-2 py-2 label-xs">Colaborador</th>
                          <th className="px-2 py-2 label-xs text-right">Capacidad</th>
                          <th className="px-2 py-2 label-xs text-right">Incidencias</th>
                          <th className="px-2 py-2 label-xs text-right">Productivas</th>
                          <th className="px-2 py-2 label-xs text-right">Costo por hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((f) => {
                          const ch = costoHoraCalculado(f);
                          const base = previo.get(f.colaborador_id) ?? 0;
                          const desvio = base > 0 && ch != null ? ((ch - base) / base) * 100 : 0;
                          const desviado = Math.abs(desvio) > 15;
                          return (
                            <tr key={f.colaborador_id} className={cn("border-b border-border last:border-0", desviado ? "bg-warning-soft" : "")}>
                              <td className="px-2 py-1.5">
                                {f.colaborador}
                                {desviado ? (
                                  <Badge tono="alerta" className="ml-2">
                                    {desvio > 0 ? "+" : ""}
                                    {n(desvio)}%
                                  </Badge>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 text-right"><Num className="tabular-nums">{n(f.capacidad_bruta)}</Num></td>
                              <td className="px-2 py-1.5 text-right"><Num className="tabular-nums">{n(f.horas_incidencia)}</Num></td>
                              <td className="px-2 py-1.5 text-right"><Num className="tabular-nums">{n(f.capacidad_productiva)}</Num></td>
                              <td className="px-2 py-1.5 text-right">
                                <Num className="tabular-nums font-semibold">
                                  {f.costo_cargado !== true ? "Sin cargar" : ch == null ? "No calculable" : soles(ch, 4)}
                                </Num>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <Aviso tono={conError.length > 0 ? "alerta" : "info"} titulo="Resumen del archivo">
                    {previsualizacion.length} filas, {validas.length} válidas, {conError.length} con error.
                  </Aviso>
                  {faltantes.length > 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      No figuran en el archivo:{" "}
                      {faltantes.map((c) => `${c.nombres ?? ""} ${c.apellidos ?? ""}`.trim() || c.documento).join(", ")}.
                    </p>
                  ) : null}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[860px] text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="px-2 py-2 label-xs">Documento</th>
                          <th className="px-2 py-2 label-xs">Colaborador</th>
                          <th className="px-2 py-2 label-xs text-right">Costo mensual</th>
                          <th className="px-2 py-2 label-xs">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previsualizacion.map((f, i) => (
                          <tr
                            key={`${f.documento}-${i}`}
                            className={cn(
                              "border-b border-border last:border-0",
                              f.estado === "ok" ? "bg-success-soft" : "bg-accent-soft",
                            )}
                          >
                            <td className="px-2 py-1.5"><Num>{f.documento || "—"}</Num></td>
                            <td className="px-2 py-1.5">{f.nombre ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right">
                              <Num className="tabular-nums">{f.costo == null ? f.costoTexto || "—" : soles(f.costo)}</Num>
                            </td>
                            <td className="px-2 py-1.5">
                              {f.estado === "ok" ? (
                                <Badge tono="exito">encontrado</Badge>
                              ) : f.estado === "sin-colaborador" ? (
                                <Badge tono="acento">documento no existe</Badge>
                              ) : (
                                <Badge tono="acento">costo inválido</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
              <p className="text-[12px] text-muted-foreground">
                {aplicado
                  ? "Se resaltan en ámbar las desviaciones mayores a 15% frente al periodo anterior."
                  : conError.length > 0
                    ? "Corrige el archivo: la carga solo se habilita cuando todas las filas son válidas."
                    : "Al confirmar se cargan los costos y la base recalcula el costo por hora."}
              </p>
              <div className="flex gap-2">
                <Button variante="secundario" onClick={() => setDialogo(false)}>
                  {aplicado ? "Cerrar" : "Cancelar"}
                </Button>
                {aplicado ? null : (
                  <Button
                    variante="primario"
                    cargando={cargaMasiva.isPending}
                    disabled={conError.length > 0 || validas.length === 0}
                    onClick={() => cargaMasiva.mutate()}
                  >
                    Confirmar carga de {validas.length} costos
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-warning" /> Desviación mayor a 15% frente a{" "}
          {anterior ? etiquetaPeriodo(anterior.anio, anterior.mes) : "el mes anterior"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-surface-muted ring-1 ring-border" /> Costo mensual sin cargar
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-accent" /> Costo por hora no calculable
        </span>
      </div>

      <Card>
        <CardHeader
          titulo="Costo por colaborador"
          descripcion={etiquetaPeriodo(periodo?.anio, periodo?.mes)}
        />
        {filasQ.isLoading ? (
          <Vacio mensaje="Cargando costos…" />
        ) : filas.length === 0 ? (
          <Vacio mensaje={`No hay datos de capacidad ni costos para ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Colaborador</th>
                  <th className="px-4 py-2 label-xs text-right">Costo mensual</th>
                  <th className="px-4 py-2 label-xs text-right">Capacidad</th>
                  <th className="px-4 py-2 label-xs text-right">Incidencias</th>
                  <th className="px-4 py-2 label-xs text-right">Horas productivas</th>
                  <th className="px-4 py-2 label-xs text-right">Costo por hora</th>
                  <th className="px-4 py-2 label-xs text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const cargado = f.costo_cargado === true;
                  const ch = costoHoraCalculado(f);
                  const noCalculable = cargado && ch == null;
                  const base = previo.get(f.colaborador_id) ?? 0;
                  const desvio = base > 0 && ch != null ? ((ch - base) / base) * 100 : 0;
                  const desviado = Math.abs(desvio) > 15;
                  return (
                    <tr
                      key={f.colaborador_id}
                      className={cn(
                        "border-b border-border last:border-0",
                        !cargado ? "bg-surface-muted" : noCalculable ? "bg-accent-soft" : desviado ? "bg-warning-soft" : "",
                      )}
                    >
                      <td className="px-4 py-2">
                        {f.colaborador}
                        {!cargado ? (
                          <Badge tono="neutro" className="ml-2">sin cargar</Badge>
                        ) : noCalculable ? (
                          <Badge tono="acento" className="ml-2">no calculable</Badge>
                        ) : desviado ? (
                          <Badge tono="alerta" className="ml-2">
                            {desvio > 0 ? "+" : ""}
                            {n(desvio)}%
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {editando === f.colaborador_id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              className="field num w-28 text-right"
                              value={monto}
                              onChange={(e) => setMonto(e.target.value)}
                              inputMode="decimal"
                              autoFocus
                            />
                            <Button
                              variante="primario"
                              cargando={guardar.isPending}
                              onClick={() => guardar.mutate({ fila: f, valor: Number(monto) })}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button variante="fantasma" onClick={() => setEditando(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Num className="tabular-nums">{cargado ? soles(f.costo_mensual) : "Sin cargar"}</Num>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.capacidad_bruta)}</Num></td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.horas_incidencia)}</Num></td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(f.capacidad_productiva)}</Num></td>
                      <td className="px-4 py-2 text-right">
                        <Num className={cn("tabular-nums font-semibold", !cargado ? "text-muted-foreground" : noCalculable ? "text-accent" : "")}>
                          {!cargado ? "Sin cargar" : noCalculable ? "No calculable" : soles(ch, 4)}
                        </Num>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {editando === f.colaborador_id ? null : (
                          <Button
                            variante="secundario"
                            onClick={() => {
                              setEditando(f.colaborador_id);
                              setMonto(String(f.costo_mensual ?? ""));
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
