import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSesion } from "@/context/session";
import { primeraRuta } from "@/lib/nav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sustenta — Control de horas y defensa tributaria" },
      {
        name: "description",
        content:
          "Plataforma de control de horas y sustento tributario de servicios intragrupo para AC Corporativo del Perú S.A.C.",
      },
      { property: "og:title", content: "Sustenta — Control de horas y defensa tributaria" },
      {
        property: "og:description",
        content: "Evidencia verificable de servicios intragrupo: horas, costos y defense file.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { rol, session, autenticando, colaborador } = useSesion();
  const navigate = useNavigate();

  useEffect(() => {
    if (autenticando) return;
    if (!session) navigate({ to: "/auth", replace: true });
    else if (colaborador) navigate({ to: primeraRuta(rol), replace: true });
  }, [rol, session, autenticando, colaborador, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-[13px] text-muted-foreground">Cargando Sustenta…</p>
    </div>
  );
}
