import type { ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Plug, PlugZap, Video } from "lucide-react";

import { Aviso, Badge, Button, Num } from "@/components/ui-kit";
import { useCuentaMicrosoft } from "@/context/microsoft";
import { horasDeReunion, type Reunion } from "@/integrations/microsoft/types";
import { horasMinutos, n } from "@/lib/formato";

/**
 * Piezas compartidas de la integración Outlook/Teams:
 * estado de conexión (conectar / desconectar / modo demo) y fila de reunión.
 * Las usa el Registro de horas y la pantalla Mi agenda.
 */

export function EstadoConexionMicrosoft() {
  const {
    cuenta,
    cargandoCuenta,
    modoDemo,
    configurado,
    conectando,
    conectar,
    desconectar,
    alternarDemo,
  } = useCuentaMicrosoft();

  if (cargandoCuenta) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
        Verificando conexión con Microsoft…
      </p>
    );
  }

  if (cuenta) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2 text-[12px]">
          <PlugZap className="h-4 w-4 shrink-0 text-success" />
          <span className="truncate font-semibold">{cuenta}</span>
        </span>
        <Button
          variante="fantasma"
          className="h-7 px-2 text-[11px]"
          onClick={() => void desconectar()}
        >
          Desconectar
        </Button>
      </div>
    );
  }

  if (modoDemo) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Badge tono="alerta">
          <Video className="h-3 w-3" /> Reuniones de ejemplo
        </Badge>
        <Button variante="fantasma" className="h-7 px-2 text-[11px]" onClick={alternarDemo}>
          Desactivar
        </Button>
      </div>
    );
  }

  if (!configurado) {
    return (
      <div className="space-y-3 p-4">
        <Aviso tono="info" titulo="Integración con Microsoft pendiente de configurar">
          Falta registrar la aplicación en Azure y definir <code>VITE_MS_CLIENT_ID</code>. Mientras
          tanto puedes explorar todo el comportamiento con reuniones de ejemplo.
        </Aviso>
        <Button variante="secundario" className="w-full" onClick={alternarDemo}>
          <Video className="h-3.5 w-3.5" /> Ver reuniones de ejemplo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-[12px] text-muted-foreground">
        Conecta tu cuenta para leer tus reuniones de Outlook y Teams. Solo lectura: Sustenta nunca
        modifica tu calendario.
      </p>
      <Button
        variante="primario"
        className="w-full"
        cargando={conectando}
        onClick={() => void conectar()}
      >
        <Plug className="h-3.5 w-3.5" /> Conectar Outlook
      </Button>
      <Button variante="fantasma" className="w-full text-[11px]" onClick={alternarDemo}>
        Probar con reuniones de ejemplo
      </Button>
    </div>
  );
}

export function FilaReunion({
  reunion,
  jornada,
  children,
}: {
  reunion: Reunion;
  jornada?: number | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Num className="shrink-0 text-info">{format(parseISO(reunion.inicio), "HH:mm")}</Num>
          <span className="min-w-0 truncate" title={reunion.titulo}>
            {reunion.titulo}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {reunion.organizador ? <>Organiza {reunion.organizador} · </> : null}
          <Num>{horasMinutos(horasDeReunion(reunion, jornada))}</Num>
          {reunion.asistentes > 0 ? (
            <>
              {" · "}
              <Num>{n(reunion.asistentes, 0)}</Num> asistentes
            </>
          ) : null}
        </p>
        {reunion.previa ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{reunion.previa}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {reunion.enlaceTeams ? (
          <a
            href={reunion.enlaceTeams}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-[6px] border border-border-strong px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-surface-muted"
          >
            <Video className="h-3 w-3" /> Unirme
          </a>
        ) : null}
        {children}
      </div>
    </div>
  );
}
