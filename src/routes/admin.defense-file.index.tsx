import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { DefenseFile, EmpresaVinculada } from "@/integrations/sustenta/types";
import { nombreEmpresa, nombrePeriodo } from "@/integrations/sustenta/types";

export const Route = createFileRoute("/admin/defense-file/")({
  head: () => ({
    meta: [
      { title: "Defense file — Sustenta" },
      {
        name: "description",
        content:
          "Expediente de defensa tributaria por empresa vinculada y periodo cerrado, con sellado SHA-256.",
      },
      { property: "og:title", content: "Defense file — Sustenta" },
      {
        property: "og:description",
        content: "Expediente de defensa tributaria con sellado verificable.",
      },
    ],
  }),
  component: DefenseFilePantalla,
});

const SECCIONES: { claves: string[]; titulo: string }[] = [
  { claves: ["naturaleza", "naturaleza_servicio", "servicio"], titulo: "Naturaleza del servicio" },
  { claves: ["personal", "personal_asignado", "colaboradores"], titulo: "Personal asignado" },
  { claves: ["horas", "horas_incurridas", "detalle_horas"], titulo: "Horas incurridas" },
  { claves: ["criterio", "criterio_asignacion", "asignacion"], titulo: "Criterio de asignación" },
  { claves: ["valorizacion", "valorización", "margen"], titulo: "Valorización y margen" },
  { claves: ["completitud", "informe_completitud", "completeness"], titulo: "Informe de completitud" },
];

function esCifra(v: unknown) {
  return typeof v === "number" || (typeof v === "string" && /^[\d.,%\s/-]+$/.test(v) && /\d/.test(v));
}

function Valor({ valor }: { valor: unknown }) {
  if (valor == null) return <span className="text-muted-foreground">—</span>;
  if (typeof valor === "boolean") return <Badge tono={valor ? "exito" : "neutro"}>{valor ? "Sí" : "No"}</Badge>;
  if (esCifra(valor)) return <Num className="text-[13px]">{String(valor)}</Num>;
  if (Array.isArray(valor)) {
    return (
      <div className="space-y-2">
        {valor.map((v, i) => (
          <div key={i} className="rounded-[6px] border border-border bg-surface-muted/40 p-2">
            <Valor valor={v} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof valor === "object") {
    return (
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {Object.entries(valor as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="label-xs">{k.replace(/_/g, " ")}</dt>
            <dd className="mt-0.5 break-words text-[13px]">
              <Valor valor={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-[13px]">{String(valor)}</span>;
}

function DefenseFilePantalla() {
  const qc = useQueryClient();
  const { periodos, colaborador } = useSesion();
  const [empresaId, setEmpresaId] = useState("");
  const [periodoId, setPeriodoId] = useState("");
  const [expediente, setExpediente] = useState<DefenseFile | null>(null);
  const [errorBD, setErrorBD] = useState<string | null>(null);

  const empresasQ = useQuery({
    queryKey: ["empresas"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_empresa_vinculada").select("*");
      if (error) throw error;
      return (data ?? []) as EmpresaVinculada[];
    },
  });

  const empresas = empresasQ.data ?? [];
  const periodosCerradosBase = periodos.filter((p) => (p.estado ?? "").toLowerCase() === "cerrado");
  const periodosCerrados = periodosCerradosBase;
  // El expediente solo existe sobre periodos cerrados: se abre en el último cerrado.
  const periodoElegido = periodos.find((p) => p.id === periodoId) ?? periodosCerrados[0] ?? null;
  const empresa = empresas.find((e) => e.id === empresaId) ?? null;
  const periodo = periodoElegido;
  const periodoSeleccionadoId = periodoElegido?.id ?? "";

  const liquidacionQ = useQuery({
    queryKey: ["liquidacion-defense", periodoSeleccionadoId],
    enabled: sustentaConfigurado && !!periodoSeleccionadoId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_liquidacion")
        .select("periodo_id")
        .eq("periodo_id", periodoSeleccionadoId);
      if (error) throw error;
      return (data ?? []).length;
    },
  });
  const sinLiquidacion = liquidacionQ.data === 0;

  const expedienteQ = useQuery({
    queryKey: ["defense-file", empresaId, periodoSeleccionadoId],
    enabled: sustentaConfigurado && !!empresaId && !!periodoSeleccionadoId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_defense_file")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("periodo_id", periodoSeleccionadoId)
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DefenseFile | null;
    },
  });

  useEffect(() => {
    setExpediente(expedienteQ.data ?? null);
  }, [expedienteQ.data]);

  const generar = useMutation({
    mutationFn: async () => {
      const { data, error } = await sustenta.rpc("hr_generar_defense_file", {
        p_empresa: empresaId,
        p_periodo: periodoSeleccionadoId,
      });
      if (error) throw error;
      // La función no garantiza devolver el id; el documento completo se vuelve a leer por empresa y periodo.
      const { data: completo, error: errorLectura } = await sustenta
        .from("hr_defense_file")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("periodo_id", periodoSeleccionadoId)
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errorLectura) throw errorLectura;
      if (!completo) throw new Error("La base generó el expediente, pero no devolvió su contenido.");
      return completo as DefenseFile;
    },
    onSuccess: (df) => {
      setErrorBD(null);
      setExpediente(df);
      qc.invalidateQueries({ queryKey: ["defense-file", empresaId, periodoSeleccionadoId] });
      toast.success("Expediente generado");
    },
    onError: (e) => {
      const msg = mensajeDeError(e);
      setErrorBD(msg);
      toast.error(msg);
    },
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      const { data, error } = await sustenta.rpc("hr_confirmar_defense_file", {
        p_id: expediente?.id,
        p_usuario: colaborador?.id,
      });
      if (error) throw error;
      const sellado = (Array.isArray(data) ? data[0] : data) as DefenseFile;
      const { data: completo, error: errorLectura } = await sustenta
        .from("hr_defense_file")
        .select("*")
        .eq("id", sellado.id)
        .single();
      if (errorLectura) throw errorLectura;
      return (completo ?? sellado) as DefenseFile;
    },
    onSuccess: (df) => {
      setErrorBD(null);
      setExpediente((prev) => ({ ...(prev ?? {}), ...(df ?? {}) }) as DefenseFile);
      toast.success("Expediente sellado");
    },
    onError: (e) => {
      const msg = mensajeDeError(e);
      setErrorBD(msg);
      toast.error(msg);
    },
  });

  const contenido = useMemo(() => {
    const raw =
      (expediente?.contenido as Record<string, unknown> | undefined) ??
      (expediente?.payload as Record<string, unknown> | undefined) ??
      (expediente?.json as Record<string, unknown> | undefined) ??
      (expediente as unknown as Record<string, unknown> | null);
    if (!raw || typeof raw !== "object") return null;
    return raw;
  }, [expediente]);

  const estado = (expediente?.estado ?? "").toLowerCase();
  const sellado = estado === "confirmado" || !!(expediente?.hash ?? expediente?.hash_sha256);
  const hash = expediente?.hash_sha256 ?? expediente?.hash ?? null;

  const usadas = new Set<string>();
  const secciones = contenido
    ? SECCIONES.map((s) => {
        const clave = s.claves.find((c) => c in contenido);
        if (clave) usadas.add(clave);
        return { titulo: s.titulo, valor: clave ? contenido[clave] : null, presente: !!clave };
      })
    : [];
  const resto = contenido
    ? Object.entries(contenido).filter(
        ([k]) => !usadas.has(k) && !["id", "hash", "hash_sha256", "estado", "contenido", "payload", "json"].includes(k),
      )
    : [];

  return (
    <AppShell>
      <PageHeader
        titulo="Defense file"
        descripcion="Expediente de sustento del servicio intragrupo, sellado y verificable."
        acciones={[
          { label: "Periodos cerrados", contador: periodosCerrados.length },
          { label: "Liquidación", to: "/admin/liquidacion" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Card>
            <CardHeader titulo="Generar expediente" descripcion="Selecciona empresa vinculada y periodo cerrado." />
            <div className="grid items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <Etiqueta>Empresa vinculada</Etiqueta>
                <select className="field mt-1" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                  <option value="">Selecciona una empresa</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {nombreEmpresa(e)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Etiqueta>Periodo cerrado</Etiqueta>
                <select
                  className="field mt-1"
                  value={periodoSeleccionadoId}
                  onChange={(e) => setPeriodoId(e.target.value)}
                >
                  {periodosCerrados.length === 0 ? <option value="">Sin periodos cerrados</option> : null}
                  {periodosCerrados.map((p) => (
                    <option key={p.id} value={p.id}>
                      {nombrePeriodo(p)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variante="primario"
                disabled={!empresaId || !periodoSeleccionadoId || sinLiquidacion}
                cargando={generar.isPending}
                onClick={() => generar.mutate()}
              >
                <FileCheck2 className="h-4 w-4" />
                Generar expediente
              </Button>
            </div>
            {sinLiquidacion ? (
              <div className="px-4 pb-4">
                <Aviso tono="alerta" titulo="Este periodo no tiene liquidación calculada">
                  {nombrePeriodo(periodo)} está cerrado pero aún no tiene importes liquidados, así que no hay
                  base para armar el expediente. Calcula los costos y la liquidación del periodo primero.
                </Aviso>
              </div>
            ) : null}
            {errorBD ? (
              <div className="px-4 pb-4">
                <Aviso tono="acento" titulo="La base rechazó la operación">
                  {errorBD}
                </Aviso>
              </div>
            ) : null}
            {expediente ? (
              <div className="border-t border-border px-4 py-3">
                <a
                  href={`/admin/defense-file/${expediente.id}/documento`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-border-strong bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-muted"
                >
                  Ver documento
                </a>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Abre el expediente como documento formal en A4, listo para imprimir o guardar en PDF.
                </p>
              </div>
            ) : null}
          </Card>

          {!contenido ? (
            <Card>
              <Vacio mensaje="Genera el expediente para ver su contenido documentado por secciones." />
            </Card>
          ) : (
            <>
              {secciones.map((s) => (
                <Card key={s.titulo}>
                  <CardHeader titulo={s.titulo} />
                  <div className="p-4">
                    {s.presente ? <Valor valor={s.valor} /> : <Vacio mensaje="Sección no incluida en el expediente." />}
                  </div>
                </Card>
              ))}
              {resto.length > 0 ? (
                <Card>
                  <CardHeader titulo="Otros datos del expediente" />
                  <div className="p-4">
                    <Valor valor={Object.fromEntries(resto)} />
                  </div>
                </Card>
              ) : null}
            </>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader titulo="Sellado del expediente" />
          <div className="space-y-4 p-4">
            <div>
              <Etiqueta>Estado</Etiqueta>
              <div className="mt-1">
                {!expediente ? (
                  <Badge tono="neutro">Sin generar</Badge>
                ) : sellado ? (
                  <Badge tono="exito">
                    <Lock className="h-3 w-3" /> Sellado
                  </Badge>
                ) : (
                  <Badge tono="alerta">Propuesto</Badge>
                )}
              </div>
            </div>

            <div>
              <Etiqueta>Empresa</Etiqueta>
              <p className="mt-0.5 text-[13px]">{nombreEmpresa(empresa)}</p>
              <Etiqueta>Periodo</Etiqueta>
              <Num className="text-[13px]">{nombrePeriodo(periodo)}</Num>
            </div>

            {sellado ? (
              <div className="space-y-3 rounded-[6px] border border-success/20 bg-success-soft p-3">
                <div>
                  <Etiqueta>Hash SHA-256</Etiqueta>
                  <Num className="mt-0.5 block break-all text-[11px] text-success">{hash ?? "—"}</Num>
                </div>
                <div>
                  <Etiqueta>Responsable</Etiqueta>
                  <p className="text-[13px] text-success">{expediente?.confirmado_por ?? "—"}</p>
                </div>
                <div>
                  <Etiqueta>Fecha de sellado</Etiqueta>
                  <Num className="text-[13px] text-success">{expediente?.confirmado_en ?? "—"}</Num>
                </div>
                <p className="flex items-start gap-1.5 text-[12px] text-success">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Expediente bloqueado: su contenido ya no puede modificarse.
                </p>
              </div>
            ) : expediente ? (
              <Button variante="primario" className="w-full" cargando={confirmar.isPending} onClick={() => confirmar.mutate()}>
                <Lock className="h-4 w-4" />
                Confirmar y sellar
              </Button>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Al generar el expediente podrás revisarlo y luego sellarlo con su hash verificable.
              </p>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
