import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { eachDayOfInterval, endOfMonth, format, parseISO, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, CalendarDays, List } from "lucide-react";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { EstadoConexionMicrosoft, FilaReunion } from "@/components/reuniones";
import { Aviso, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { useCuentaMicrosoft } from "@/context/microsoft";
import { useReuniones } from "@/integrations/microsoft/hooks";
import type { Reunion } from "@/integrations/microsoft/types";
import { mensajeDeError } from "@/integrations/sustenta/client";
import { fechaCorta, horasMinutos, n, rangoMes } from "@/lib/formato";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/horas/agenda")({
  head: () => ({
    meta: [
      { title: "Mi agenda — Sustenta" },
      { name: "description", content: "Reuniones de Outlook y Teams del periodo activo." },
      { property: "og:title", content: "Mi agenda — Sustenta" },
      { property: "og:description", content: "Reuniones de Outlook y Teams del periodo activo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MiAgenda,
});

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

function iso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function MiAgenda() {
  const { periodos } = useSesion();
  const { cuenta, modoDemo, conectar } = useCuentaMicrosoft();
  const [vista, setVista] = useState<"lista" | "calendario">("calendario");

  const periodo = periodos.find((p) => (p.estado ?? "").toLowerCase() === "abierto") ?? null;
  const rango = periodo?.anio && periodo?.mes ? rangoMes(periodo.anio, periodo.mes) : null;
  const mes = periodo?.anio && periodo?.mes ? new Date(periodo.anio, periodo.mes - 1, 1) : null;

  const reunionesQ = useReuniones(
    periodo?.anio && periodo?.mes && rango
      ? { inicio: rango.inicio, fin: rango.fin, anio: periodo.anio, mes: periodo.mes }
      : null,
  );
  const reuniones = reunionesQ.data ?? [];

  const semanas = useMemo(() => {
    const mapa = new Map<string, Reunion[]>();
    for (const reunion of reuniones) {
      const clave = format(
        startOfWeek(parseISO(reunion.inicio), { weekStartsOn: 1 }),
        "yyyy-MM-dd",
      );
      const lista = mapa.get(clave);
      if (lista) lista.push(reunion);
      else mapa.set(clave, [reunion]);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [reuniones]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Reunion[]>();
    for (const reunion of reuniones) {
      const lista = mapa.get(reunion.dia);
      if (lista) lista.push(reunion);
      else mapa.set(reunion.dia, [reunion]);
    }
    return mapa;
  }, [reuniones]);

  const dias = useMemo(
    () => (mes ? eachDayOfInterval({ start: mes, end: endOfMonth(mes) }) : []),
    [mes],
  );
  const totalReuniones = reuniones.length;
  const hoy = iso(new Date());

  if (!periodo || !rango || !mes) {
    return (
      <AppShell>
        <PageHeader
          titulo="Mi agenda"
          descripcion="Reuniones de Outlook y Teams del periodo activo."
        />
        <Card>
          <div className="p-6">
            <Aviso tono="alerta" titulo="No hay un periodo abierto">
              La agenda se organiza por periodo. Administración debe aperturar un periodo para ver
              reuniones.
            </Aviso>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        titulo="Mi agenda"
        descripcion={`Reuniones de Outlook y Teams de ${format(mes, "MMMM yyyy", { locale: es })}.`}
        acciones={[{ label: "Ir al registro de horas", to: "/horas/registro" }]}
      />

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[340px_minmax(520px,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              titulo="Conexión"
              descripcion="Cuenta de Microsoft que alimenta la agenda."
            />
            <EstadoConexionMicrosoft />
          </Card>
          <Card>
            <CardHeader titulo="Resumen del mes" />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-border bg-border">
              <div className="bg-surface p-3">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <p className="mt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Reuniones
                </p>
                <Num className="mt-1 block text-[17px] font-semibold">{n(totalReuniones, 0)}</Num>
              </div>
              <div className="bg-surface p-3">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <p className="mt-2 text-[10px] font-semibold uppercase text-muted-foreground">
                  Días con reuniones
                </p>
                <Num className="mt-1 block text-[17px] font-semibold">{n(porDia.size, 0)}</Num>
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            titulo={format(mes, "MMMM yyyy", { locale: es })}
            descripcion={
              cuenta
                ? `Leyendo el calendario de ${cuenta}`
                : modoDemo
                  ? "Reuniones de ejemplo del modo demo"
                  : "Sin origen de reuniones activo"
            }
            accion={
              <div className="flex items-center gap-1">
                <Button
                  variante={vista === "lista" ? "secundario" : "fantasma"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setVista("lista")}
                >
                  <List className="h-3 w-3" /> Lista
                </Button>
                <Button
                  variante={vista === "calendario" ? "secundario" : "fantasma"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setVista("calendario")}
                >
                  <CalendarDays className="h-3 w-3" /> Calendario
                </Button>
              </div>
            }
          />

          {reunionesQ.error ? (
            <div className="space-y-2 p-4">
              <Aviso tono="alerta" titulo="Microsoft Graph respondió">
                {mensajeDeError(reunionesQ.error)}
              </Aviso>
              <Button variante="secundario" onClick={() => void conectar()}>
                Reconectar
              </Button>
            </div>
          ) : !cuenta && !modoDemo ? (
            <Vacio mensaje="Conecta tu cuenta de Outlook o activa el modo demo para ver reuniones." />
          ) : totalReuniones === 0 ? (
            <Vacio mensaje={`Sin reuniones en ${format(mes, "MMMM yyyy", { locale: es })}.`} />
          ) : vista === "lista" ? (
            <div className="divide-y divide-border">
              {semanas.map(([clave, delSemana]) => (
                <div key={clave}>
                  <p className="bg-surface-muted px-4 py-2 text-[11px] font-semibold text-muted-foreground">
                    Semana del <Num>{fechaCorta(clave)}</Num>
                  </p>
                  <div className="divide-y divide-border">
                    {delSemana.map((reunion) => (
                      <FilaReunion key={reunion.id} reunion={reunion} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <div className="grid grid-cols-7 gap-1.5">
                {DIAS.map((nombre, i) => (
                  <span key={`${nombre}-${i}`} className="label-xs py-1 text-center">
                    {nombre}
                  </span>
                ))}
                {Array.from({ length: (mes.getDay() + 6) % 7 }).map((_, i) => (
                  <span key={`vacio-${i}`} />
                ))}
                {dias.map((dia) => {
                  const fecha = iso(dia);
                  const delDia = porDia.get(fecha) ?? [];
                  const esHoy = fecha === hoy;
                  return (
                    <div
                      key={fecha}
                      className={cn(
                        "min-h-20 rounded-[6px] border p-2",
                        delDia.length > 0
                          ? "border-info/25 bg-info-soft/50"
                          : "border-border bg-surface-muted/60",
                        esHoy && "ring-1 ring-foreground",
                      )}
                    >
                      <Num className={cn("text-[12px] font-semibold", esHoy && "text-accent")}>
                        {format(dia, "d")}
                      </Num>
                      <div className="mt-1 space-y-1">
                        {delDia.slice(0, 3).map((reunion) => (
                          <p
                            key={reunion.id}
                            className="truncate text-[9px] font-semibold text-info"
                            title={reunion.titulo}
                          >
                            <Num>{format(parseISO(reunion.inicio), "HH:mm")}</Num> {reunion.titulo}
                          </p>
                        ))}
                        {delDia.length > 3 ? (
                          <p className="text-[9px] text-muted-foreground">
                            <Num>+{n(delDia.length - 3, 0)}</Num> más
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
