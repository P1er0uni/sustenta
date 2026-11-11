import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { KPI, KPIGrid } from "@/components/metrics";
import { SelectorPeriodo, usePeriodoSeleccionado } from "@/components/PeriodoSelector";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { LiquidacionFila, RegistroDetalle } from "@/integrations/sustenta/vistas";
import { etiquetaPeriodo, n, pct, soles } from "@/lib/formato";

export const Route = createFileRoute("/admin/liquidacion")({
  head: () => ({
    meta: [
      { title: "Liquidación — Sustenta" },
      { name: "description", content: "Importe a facturar por empresa vinculada: costo, margen y horas cobrables." },
      { property: "og:title", content: "Liquidación — Sustenta" },
      { property: "og:description", content: "Costo, margen y total a facturar por empresa vinculada." },
    ],
  }),
  component: Liquidacion,
});

interface Agrupado {
  empresa_id: string;
  razon_social: string;
  margen_pct: number;
  horas_cobrables: number;
  horas_no_cobrables: number;
  costo_cobrable: number;
  costo_no_cobrable: number;
  margen: number;
  total: number;
}

function siglaEmpresa(razon: string) {
  const letras = razon.replace(/[^a-zA-ZÁÉÍÓÚÑáéíóúñ]/g, "").toUpperCase();
  return letras.slice(0, 5) || "EMPRESA";
}

function Liquidacion() {
  const { periodo, periodoId, setPeriodoId, periodos } = usePeriodoSeleccionado(true);

  const filasQ = useQuery({
    queryKey: ["liquidacion", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_liquidacion").select("*").eq("periodo_id", periodoId);
      if (error) throw error;
      return (data ?? []) as LiquidacionFila[];
    },
  });

  const empresasTodas = useMemo(() => {
    const mapa = new Map<string, Agrupado>();
    for (const f of filasQ.data ?? []) {
      const a =
        mapa.get(f.empresa_id) ??
        ({
          empresa_id: f.empresa_id,
          razon_social: f.razon_social ?? "—",
          margen_pct: Number(f.margen_pct ?? 0),
          horas_cobrables: 0,
          horas_no_cobrables: 0,
          costo_cobrable: 0,
          costo_no_cobrable: 0,
          margen: 0,
          total: 0,
        } as Agrupado);
      a.horas_cobrables += Number(f.horas_cobrables ?? 0);
      a.horas_no_cobrables += Number(f.horas_no_cobrables ?? 0);
      a.costo_cobrable += Number(f.costo_cobrable ?? 0);
      a.costo_no_cobrable += Number(f.costo_no_cobrable ?? 0);
      a.margen += Number(f.margen ?? 0);
      a.total += Number(f.total_facturar ?? 0);
      mapa.set(f.empresa_id, a);
    }
    return [...mapa.values()].sort((x, y) => y.total - x.total);
  }, [filasQ.data]);

  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const idsTodas = useMemo(() => empresasTodas.map((e) => e.empresa_id).join("|"), [empresasTodas]);

  useEffect(() => {
    setSeleccionadas(idsTodas ? idsTodas.split("|") : []);
  }, [idsTodas]);

  const empresas = useMemo(
    () => empresasTodas.filter((e) => seleccionadas.includes(e.empresa_id)),
    [empresasTodas, seleccionadas],
  );
  const todasMarcadas = empresasTodas.length > 0 && seleccionadas.length === empresasTodas.length;

  const totales = empresas.reduce(
    (acc, e) => ({
      horas_cobrables: acc.horas_cobrables + e.horas_cobrables,
      horas_no_cobrables: acc.horas_no_cobrables + e.horas_no_cobrables,
      costo_cobrable: acc.costo_cobrable + e.costo_cobrable,
      costo_no_cobrable: acc.costo_no_cobrable + e.costo_no_cobrable,
      margen: acc.margen + e.margen,
      total: acc.total + e.total,
    }),
    { horas_cobrables: 0, horas_no_cobrables: 0, costo_cobrable: 0, costo_no_cobrable: 0, margen: 0, total: 0 },
  );

  const aCostoPuro = empresas.filter((e) => e.margen_pct === 0);

  const [descargando, setDescargando] = useState(false);

  async function descargarExcel() {
    setDescargando(true);
    try {
      const XLSX = await import("xlsx");
      const filas = (filasQ.data ?? []).filter((f) => seleccionadas.includes(f.empresa_id));
      const nombresEmpresas = empresas.map((e) => e.razon_social);

      const { data: registros, error: errReg } = await sustenta
        .from("hr_v_registro_detalle")
        .select("*")
        .eq("periodo_id", periodoId);
      if (errReg) throw errReg;

      const encabezado = [
        [`Liquidación ${etiquetaPeriodo(periodo?.anio, periodo?.mes)}`],
        [`Empresas incluidas: ${todasMarcadas ? "Todas las empresas" : nombresEmpresas.join(", ")}`],
        [],
      ];
      const hojaEmpresas = XLSX.utils.aoa_to_sheet(encabezado);
      XLSX.utils.sheet_add_json(
        hojaEmpresas,
        empresas.map((e) => ({
          Empresa: e.razon_social,
          "Horas cobrables": e.horas_cobrables,
          "Horas no cobrables": e.horas_no_cobrables,
          "Costo cobrable": e.costo_cobrable,
          "Margen %": e.margen_pct,
          Margen: e.margen,
          "Costo no cobrable": e.costo_no_cobrable,
          "Total a facturar": e.total,
        })),
        { origin: -1 },
      );
      XLSX.utils.sheet_add_json(
        hojaEmpresas,
        [
          {
            Empresa: "TOTALES",
            "Horas cobrables": totales.horas_cobrables,
            "Horas no cobrables": totales.horas_no_cobrables,
            "Costo cobrable": totales.costo_cobrable,
            "Margen %": null,
            Margen: totales.margen,
            "Costo no cobrable": totales.costo_no_cobrable,
            "Total a facturar": totales.total,
          },
        ],
        { skipHeader: true, origin: -1 },
      );

      const hojaProyectos = XLSX.utils.json_to_sheet(
        filas.map((f) => ({
          Empresa: f.razon_social ?? "",
          Proyecto: f.proyecto ?? "",
          "Horas cobrables": Number(f.horas_cobrables ?? 0),
          "Horas no cobrables": Number(f.horas_no_cobrables ?? 0),
          "Costo cobrable": Number(f.costo_cobrable ?? 0),
          "Margen %": Number(f.margen_pct ?? 0),
          Margen: Number(f.margen ?? 0),
          "Costo no cobrable": Number(f.costo_no_cobrable ?? 0),
          "Total a facturar": Number(f.total_facturar ?? 0),
        })),
      );

      const hojaColaboradores = XLSX.utils.json_to_sheet(
        ((registros ?? []) as RegistroDetalle[])
          .filter((r) => todasMarcadas || nombresEmpresas.includes(r.empresa ?? ""))
          .map((r) => ({
            Colaborador: r.colaborador ?? "",
            Proyecto: r.proyecto_nombre ?? r.proyecto_codigo ?? "",
            Empresa: r.empresa ?? "",
            Fecha: r.fecha,
            Horas: Number(r.horas ?? 0),
            Cobrable: r.cobrable ? "Sí" : "No",
            "Costo por hora": r.costo_hora == null ? null : Number(r.costo_hora),
            Costo: r.costo == null ? null : Number(r.costo),
          })),
      );

      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hojaEmpresas, "Resumen por empresa");
      XLSX.utils.book_append_sheet(libro, hojaProyectos, "Detalle por proyecto");
      XLSX.utils.book_append_sheet(libro, hojaColaboradores, "Detalle por colaborador");

      const codigo = `${periodo?.anio ?? ""}-${String(periodo?.mes ?? "").padStart(2, "0")}`;
      const sufijo = todasMarcadas
        ? ""
        : empresas.length === 1
          ? `_${siglaEmpresa(empresas[0]!.razon_social)}`
          : `_${empresas.length}-empresas`;
      XLSX.writeFile(libro, `Liquidacion_${codigo}${sufijo}.xlsx`);
      toast.success("Liquidación descargada");
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setDescargando(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        titulo="Liquidación"
        descripcion="Importe a facturar a cada empresa vinculada del grupo, con su costo y margen."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SelectorPeriodo periodos={periodos} valor={periodoId} onChange={setPeriodoId} />
        <div className="flex flex-wrap items-center gap-2">
          {empresas.length === 0 && empresasTodas.length > 0 ? (
            <span className="text-[12px] text-muted-foreground">Selecciona al menos una empresa</span>
          ) : null}
          <Button
            variante="primario"
            disabled={empresas.length === 0}
            cargando={descargando}
            onClick={() => void descargarExcel()}
          >
            <Download className="h-3.5 w-3.5" />
            Descargar liquidación
          </Button>
        </div>
      </div>

      {filasQ.error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(filasQ.error)}</Aviso>
        </div>
      ) : null}

      {empresasTodas.length > 0 ? (
        <Card className="mb-4">
          <CardHeader titulo="Empresas incluidas" descripcion="Filtra los indicadores, la tabla y la descarga." />
          <div className="flex flex-wrap gap-x-5 gap-y-2 p-4 text-[13px]">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={todasMarcadas}
                onChange={(e) => setSeleccionadas(e.target.checked ? empresasTodas.map((x) => x.empresa_id) : [])}
              />
              Todas las empresas
            </label>
            {empresasTodas.map((e) => (
              <label key={e.empresa_id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={seleccionadas.includes(e.empresa_id)}
                  onChange={(ev) =>
                    setSeleccionadas((prev) =>
                      ev.target.checked ? [...prev, e.empresa_id] : prev.filter((id) => id !== e.empresa_id),
                    )
                  }
                />
                {e.razon_social}
              </label>
            ))}
          </div>
        </Card>
      ) : null}

      {periodos.length === 0 ? (
        <Card>
          <Vacio mensaje="No hay periodos cerrados: la liquidación se genera después del cierre." />
        </Card>
      ) : filasQ.isLoading ? (
        <Card><Vacio mensaje="Cargando liquidación…" /></Card>
      ) : empresasTodas.length === 0 ? (
        <Card>
          <Vacio mensaje={`La liquidación de ${etiquetaPeriodo(periodo?.anio, periodo?.mes)} no está calculada. Los costos pendientes no se muestran como importes en cero.`} />
        </Card>
      ) : empresas.length === 0 ? (
        <Card>
          <Vacio mensaje="Selecciona al menos una empresa para ver la liquidación." />
        </Card>
      ) : (
        <>
          <KPIGrid>
            <KPI etiqueta="Empresas vinculadas" valor={n(empresas.length, 0)} />
            <KPI etiqueta="Horas cobrables" valor={n(totales.horas_cobrables)} unidad="h" />
            <KPI etiqueta="Margen del periodo" valor={soles(totales.margen)} tono="exito" />
            <KPI etiqueta="Total a facturar" valor={soles(totales.total)} grande />
          </KPIGrid>

          <Card>
            <CardHeader
              titulo="Detalle por empresa vinculada"
              descripcion={etiquetaPeriodo(periodo?.anio, periodo?.mes)}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2 label-xs">Empresa</th>
                    <th className="px-4 py-2 label-xs text-right">H. cobrables</th>
                    <th className="px-4 py-2 label-xs text-right">H. no cobrables</th>
                    <th className="px-4 py-2 label-xs text-right">Costo cobrable</th>
                    <th className="px-4 py-2 label-xs text-right">Margen</th>
                    <th className="px-4 py-2 label-xs text-right">Costo no cobrable</th>
                    <th className="px-4 py-2 label-xs text-right">Total a facturar</th>
                  </tr>
                </thead>
                <tbody>
                  {empresas.map((e) => (
                    <tr key={e.empresa_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        {e.razon_social}
                        {e.margen_pct === 0 ? (
                          <Badge tono="info" className="ml-2">a costo puro</Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(e.horas_cobrables)}</Num></td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(e.horas_no_cobrables)}</Num></td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(e.costo_cobrable)}</Num></td>
                      <td className="px-4 py-2 text-right">
                        <Num className="tabular-nums">{soles(e.margen)}</Num>
                        <span className="ml-1 text-[11px] text-muted-foreground">{pct(e.margen_pct, 0)}</span>
                      </td>
                      <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(e.costo_no_cobrable)}</Num></td>
                      <td className="px-4 py-2 text-right font-semibold"><Num className="tabular-nums">{soles(e.total)}</Num></td>
                    </tr>
                  ))}
                  <tr className="border-t border-border-strong bg-surface-muted font-semibold">
                    <td className="px-4 py-2">Totales</td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(totales.horas_cobrables)}</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(totales.horas_no_cobrables)}</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(totales.costo_cobrable)}</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(totales.margen)}</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(totales.costo_no_cobrable)}</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{soles(totales.total)}</Num></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {aCostoPuro.length > 0 ? (
            <div className="mt-4">
              <Aviso tono="info" titulo="Empresas facturadas a costo puro">
                {aCostoPuro.map((e) => e.razon_social).join(", ")} tienen margen 0%. Es una política de precios
                válida y deliberada del grupo, no una configuración faltante: se factura el costo sin utilidad.
              </Aviso>
            </div>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
