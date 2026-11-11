import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { AlertaFila, NotificacionEnvio, TipoAlerta } from "@/integrations/sustenta/vistas";
import { codigoPeriodo, fechaCorta, n } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notificaciones")({
  head: () => ({
    meta: [
      { title: "Alertas y notificaciones — Sustenta" },
      { name: "description", content: "Configura los tipos de alerta, revisa las vigentes y la cola de envío." },
      { property: "og:title", content: "Alertas y notificaciones — Sustenta" },
      { property: "og:description", content: "Motor de alertas del control de horas y defensa tributaria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Notificaciones,
});

const SEVERIDADES = ["informativa", "importante", "critica"] as const;

export function tonoSeveridad(sev?: string | null): "neutro" | "alerta" | "acento" {
  const s = (sev ?? "").toLowerCase();
  if (s === "critica") return "acento";
  if (s === "importante") return "alerta";
  return "neutro";
}

type Pestana = "configuracion" | "vigentes" | "cola";

function Notificaciones() {
  const qc = useQueryClient();
  const { periodos, periodoActivo } = useSesion();
  const [pestana, setPestana] = useState<Pestana>("configuracion");
  const [periodoSel, setPeriodoSel] = useState("");
  const [filtroSeveridad, setFiltroSeveridad] = useState("");
  const [filtroDestinatario, setFiltroDestinatario] = useState("");
  const [error, setError] = useState<string | null>(null);

  const periodo = periodos.find((p) => p.id === periodoSel) ?? periodoActivo ?? periodos[0] ?? null;
  const periodoId = periodo?.id ?? "";

  const tiposQ = useQuery({
    queryKey: ["tipos-alerta"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_tipo_alerta").select("*").order("orden");
      if (err) throw err;
      return (data ?? []) as TipoAlerta[];
    },
  });

  const alertasQ = useQuery({
    queryKey: ["alertas-periodo", periodoId],
    enabled: sustentaConfigurado && !!periodoId,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_v_alerta").select("*").eq("periodo_id", periodoId);
      if (err) throw err;
      return (data ?? []) as AlertaFila[];
    },
  });

  const colaQ = useQuery({
    queryKey: ["cola-envio"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta
        .from("hr_notificacion_envio")
        .select("*")
        .order("creado_en", { ascending: false })
        .limit(200);
      if (err) throw err;
      return (data ?? []) as NotificacionEnvio[];
    },
  });

  const actualizarTipo = useMutation({
    mutationFn: async (args: { codigo: string; cambios: Partial<TipoAlerta> }) => {
      const { error: err } = await sustenta.from("hr_tipo_alerta").update(args.cambios).eq("codigo", args.codigo);
      if (err) throw err;
    },
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["tipos-alerta"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const recalcular = useMutation({
    mutationFn: async () => {
      const { error: err } = await sustenta.rpc("hr_evaluar_alertas", { p_periodo: periodoId || null });
      if (err) throw err;
    },
    onSuccess: async () => {
      setError(null);
      toast.success("Alertas recalculadas");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["alertas-periodo"] }),
        qc.invalidateQueries({ queryKey: ["alertas"] }),
        qc.invalidateQueries({ queryKey: ["cola-envio"] }),
      ]);
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const alertas = alertasQ.data ?? [];
  const destinatarios = useMemo(() => {
    const mapa = new Map<string, string>();
    alertas.forEach((a) => {
      if (a.destinatario_id) mapa.set(a.destinatario_id, a.destinatario ?? "Sin nombre");
    });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [alertas]);

  const alertasVisibles = alertas.filter((a) => {
    if (filtroSeveridad && (a.severidad ?? "") !== filtroSeveridad) return false;
    if (filtroDestinatario && a.destinatario_id !== filtroDestinatario) return false;
    return true;
  });

  return (
    <AppShell>
      <PageHeader
        titulo="Alertas y notificaciones"
        descripcion="Qué se avisa, a quién y por qué canal. El motor recalcula las alertas del periodo."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1">
          {([
            { valor: "configuracion", label: "Configuración" },
            { valor: "vigentes", label: "Alertas vigentes" },
            { valor: "cola", label: "Cola de envío" },
          ] as { valor: Pestana; label: string }[]).map((p) => (
            <button
              key={p.valor}
              onClick={() => setPestana(p.valor)}
              className={cn(
                "rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold",
                pestana === p.valor ? "bg-accent-soft text-accent" : "text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="mb-4"><Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso></div> : null}

      {pestana === "configuracion" ? (
        <Card>
          <CardHeader
            titulo="Tipos de alerta"
            descripcion="Activa cada aviso, ajusta su severidad y elige por dónde llega."
          />
          <div className="px-4 pt-3">
            <Aviso tono="neutro" titulo="Correo pendiente de habilitar">
              El canal de correo deja la alerta encolada, pero todavía no despacha: falta configurar el servidor de
              envío.
            </Aviso>
          </div>
          {tiposQ.error ? (
            <div className="p-4"><Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(tiposQ.error)}</Aviso></div>
          ) : (tiposQ.data ?? []).length === 0 ? (
            <Vacio mensaje="No hay tipos de alerta configurados." />
          ) : (
            <div className="overflow-x-auto p-3">
              <table className="w-full min-w-[880px] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2">Alerta</th>
                    <th className="px-3 py-2">Destinatario</th>
                    <th className="px-3 py-2">Severidad</th>
                    <th className="px-3 py-2 text-center">Activa</th>
                    <th className="px-3 py-2 text-center">Aplicación</th>
                    <th className="px-3 py-2 text-center">Correo</th>
                    <th className="px-3 py-2 text-right">Días antes</th>
                  </tr>
                </thead>
                <tbody>
                  {(tiposQ.data ?? []).map((t) => (
                    <tr key={t.codigo} className="border-b border-border align-top">
                      <td className="px-3 py-2">
                        <p className="font-semibold">{t.nombre ?? t.codigo}</p>
                        <p className="max-w-[320px] text-[11px] text-muted-foreground">{t.descripcion ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2 capitalize">{t.destinatario ?? "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          className="field"
                          value={(t.severidad ?? "informativa").toLowerCase()}
                          onChange={(e) => actualizarTipo.mutate({ codigo: t.codigo, cambios: { severidad: e.target.value } })}
                        >
                          {SEVERIDADES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Activar ${t.nombre ?? t.codigo}`}
                          checked={!!t.activo}
                          onChange={(e) => actualizarTipo.mutate({ codigo: t.codigo, cambios: { activo: e.target.checked } })}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Canal aplicación ${t.nombre ?? t.codigo}`}
                          checked={!!t.canal_app}
                          onChange={(e) => actualizarTipo.mutate({ codigo: t.codigo, cambios: { canal_app: e.target.checked } })}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Canal correo ${t.nombre ?? t.codigo}`}
                          checked={!!t.canal_correo}
                          onChange={(e) => actualizarTipo.mutate({ codigo: t.codigo, cambios: { canal_correo: e.target.checked } })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          className="field num w-20 text-right"
                          value={t.dias_antes ?? ""}
                          onChange={(e) =>
                            actualizarTipo.mutate({
                              codigo: t.codigo,
                              cambios: { dias_antes: e.target.value === "" ? null : Number(e.target.value) },
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {pestana === "vigentes" ? (
        <Card>
          <CardHeader
            titulo="Alertas vigentes"
            descripcion="Lo que hoy está pendiente de resolver en el periodo."
            accion={
              <Button variante="primario" cargando={recalcular.isPending} onClick={() => recalcular.mutate()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Recalcular alertas
              </Button>
            }
          />
          <div className="grid gap-3 p-3 sm:grid-cols-3">
            <div>
              <label className="label-xs" htmlFor="periodo">Periodo</label>
              <select id="periodo" className="field mt-1" value={periodo?.id ?? ""} onChange={(e) => setPeriodoSel(e.target.value)}>
                {periodos.map((p) => <option key={p.id} value={p.id}>{codigoPeriodo(p.anio, p.mes)} · {p.estado}</option>)}
              </select>
            </div>
            <div>
              <label className="label-xs" htmlFor="sev">Severidad</label>
              <select id="sev" className="field mt-1" value={filtroSeveridad} onChange={(e) => setFiltroSeveridad(e.target.value)}>
                <option value="">Todas</option>
                {SEVERIDADES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label-xs" htmlFor="dest">Destinatario</label>
              <select id="dest" className="field mt-1" value={filtroDestinatario} onChange={(e) => setFiltroDestinatario(e.target.value)}>
                <option value="">Todos</option>
                {destinatarios.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </select>
            </div>
          </div>
          {alertasQ.error ? (
            <div className="p-4"><Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(alertasQ.error)}</Aviso></div>
          ) : alertasVisibles.length === 0 ? (
            <Vacio mensaje="No hay alertas vigentes con estos filtros." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2">Severidad</th>
                    <th className="px-3 py-2">Alerta</th>
                    <th className="px-3 py-2">Destinatario</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2">Generada</th>
                    <th className="px-3 py-2">Leída</th>
                  </tr>
                </thead>
                <tbody>
                  {alertasVisibles.map((a, i) => (
                    <tr key={`${a.tipo_codigo}-${a.destinatario_id}-${i}`} className="border-b border-border align-top">
                      <td className="px-3 py-2"><Badge tono={tonoSeveridad(a.severidad)}>{a.severidad ?? "—"}</Badge></td>
                      <td className="px-3 py-2">
                        <p className="font-semibold">{a.titulo ?? a.tipo_nombre ?? a.tipo_codigo}</p>
                        <p className="max-w-[420px] text-[11px] text-muted-foreground">{a.detalle ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2">{a.destinatario ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><Num>{n(a.cantidad ?? 0, 0)}</Num></td>
                      <td className="px-3 py-2"><Num>{fechaCorta(a.generada_en?.slice(0, 10))}</Num></td>
                      <td className="px-3 py-2"><Num>{a.leida_en ? fechaCorta(a.leida_en.slice(0, 10)) : "—"}</Num></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {pestana === "cola" ? (
        <Card>
          <CardHeader titulo="Cola de envío" descripcion="Despachos por canal. Mientras el correo no esté configurado, solo se encolan." />
          {colaQ.error ? (
            <div className="p-4"><Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(colaQ.error)}</Aviso></div>
          ) : (colaQ.data ?? []).length === 0 ? (
            <Vacio mensaje="La cola está vacía: ningún tipo de alerta tiene el correo activo." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Canal</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Intentos</th>
                    <th className="px-3 py-2">Creado</th>
                  </tr>
                </thead>
                <tbody>
                  {(colaQ.data ?? []).map((e) => (
                    <tr key={e.id} className="border-b border-border">
                      <td className="px-3 py-2">{e.estado ?? "—"}</td>
                      <td className="px-3 py-2">{e.canal ?? "—"}</td>
                      <td className="px-3 py-2">{e.destino ?? "—"}</td>
                      <td className="px-3 py-2">{e.tipo_codigo ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><Num>{n(e.intentos ?? 0, 0)}</Num></td>
                      <td className="px-3 py-2"><Num>{fechaCorta(e.creado_en?.slice(0, 10))}</Num></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </AppShell>
  );
}
