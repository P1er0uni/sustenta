import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui-kit";
import { leerInformeIA } from "@/lib/analizar";
import { tokenSesion } from "@/lib/informes-ia";

interface InformeEditarSearch {
  /** "lote" = informe consolidado del envío; "registro" (por defecto) = individual. */
  tipo: "registro" | "lote";
  /** Para lote: día de trabajo del envío; para registro: fecha del registro. */
  fecha: string;
  colaborador: string;
  proyectoCodigo: string;
  htmlArchivo: string;
  registroId: string;
  /** Solo para lote: ids de los registros del envío, separados por coma. */
  registroIds: string;
}

export const Route = createFileRoute("/informe/editar")({
  validateSearch: (search: Record<string, unknown>): InformeEditarSearch => ({
    tipo: search["tipo"] === "lote" ? "lote" : "registro",
    fecha: typeof search["fecha"] === "string" ? (search["fecha"] as string) : "",
    colaborador: typeof search["colaborador"] === "string" ? (search["colaborador"] as string) : "",
    proyectoCodigo: typeof search["proyectoCodigo"] === "string" ? (search["proyectoCodigo"] as string) : "",
    htmlArchivo: typeof search["htmlArchivo"] === "string" ? (search["htmlArchivo"] as string) : "",
    registroId: typeof search["registroId"] === "string" ? (search["registroId"] as string) : "",
    registroIds: typeof search["registroIds"] === "string" ? (search["registroIds"] as string) : "",
  }),
  head: () => ({
    meta: [{ title: "Informe — Sustenta" }],
  }),
  component: InformeEditar,
});

function InformeEditar() {
  const { htmlArchivo } = Route.useSearch();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);

  // Cargar el HTML del informe por la server fn (local: disco; Vercel: Storage)
  // y montarlo con srcDoc en modo solo lectura.
  useEffect(() => {
    let activo = true;
    setHtml(null);
    if (!htmlArchivo) return;
    void (async () => {
      try {
        const res = await leerInformeIA({ data: { archivo: htmlArchivo, token: await tokenSesion() } });
        if (!activo) return;
        if (!res.ok || !res.contenidoBase64) {
          toast.error(res.error ?? "No se pudo cargar el informe.");
          return;
        }
        const bin = atob(res.contenidoBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        setHtml(new TextDecoder().decode(bytes));
      } catch (e) {
        if (activo) toast.error(`No se pudo cargar el informe: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      activo = false;
    };
  }, [htmlArchivo]);

  const cerrar = () => {
    // La pestaña se abrió con window.open: intentar cerrarla.
    window.close();
    // Si el navegador bloquea el cierre, navegar a la bandeja de aprobaciones.
    window.setTimeout(() => {
      window.location.href = "/horas/aprobaciones";
    }, 150);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2 shadow-sm">
        <h1 className="text-sm font-semibold text-foreground">Informe</h1>
        <Button type="button" onClick={cerrar} className="gap-1.5">
          Cerrar
        </Button>
      </header>
      <div className="flex-1 overflow-hidden bg-white p-4">
        {html === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={html}
            className="h-full w-full bg-white"
            title="Informe"
          />
        )}
      </div>
    </div>
  );
}
