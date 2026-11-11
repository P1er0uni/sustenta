import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, LogIn } from "lucide-react";
import { sustenta, mensajeDeError } from "@/integrations/sustenta/client";
import { useSesion } from "@/context/session";
import { primeraRuta } from "@/lib/nav";
import { Button, Card, Aviso } from "@/components/ui-kit";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Acceso — Sustenta" },
      { name: "description", content: "Ingresa a Sustenta, el control de horas y defensa tributaria de AC Corporativo del Perú." },
      { property: "og:title", content: "Acceso — Sustenta" },
      { property: "og:description", content: "Control de horas y sustento tributario de servicios intragrupo." },
    ],
  }),
  component: Auth,
});

const CLAVE_DEMO = "Sustenta2026!";

const CUENTAS = [
  { email: "oroque@accorporativo.pe", nombre: "Óscar Roque Anampa", rol: "Colaborador" },
  { email: "cneyra@accorporativo.pe", nombre: "Claudia Neyra Vílchez", rol: "Jefatura" },
  { email: "msalcedo@accorporativo.pe", nombre: "Mónica Salcedo Ruiz", rol: "Administración" },
  { email: "fugaz@accorporativo.pe", nombre: "Fernando Ugaz Prado", rol: "Finanzas" },
  { email: "pvergara@accorporativo.pe", nombre: "Patricia Vergara Lume", rol: "Gestión Tributaria" },
];

function Auth() {
  const { session, rol, colaborador } = useSesion();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState(CLAVE_DEMO);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);

  useEffect(() => {
    if (session && colaborador) navigate({ to: primeraRuta(rol), replace: true });
  }, [session, colaborador, rol, navigate]);

  async function entrar(correo: string, password: string) {
    setError(null);
    setCargando(correo);
    const { error: err } = await sustenta.auth.signInWithPassword({ email: correo, password });
    setCargando(null);
    if (err) setError(mensajeDeError(err));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-4xl gap-5 md:grid-cols-2">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-accent">
              <ShieldCheck className="h-4 w-4 text-accent-foreground" />
            </span>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold">Sustenta</p>
              <p className="text-[11px] text-muted-foreground">AC Corporativo del Perú S.A.C.</p>
            </div>
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void entrar(email.trim(), clave);
            }}
          >
            <div>
              <label className="label-xs" htmlFor="email">Correo</label>
              <input
                id="email"
                type="email"
                className="field mt-1 w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@accorporativo.pe"
                required
              />
            </div>
            <div>
              <label className="label-xs" htmlFor="clave">Contraseña</label>
              <input
                id="clave"
                type="password"
                className="field mt-1 w-full num"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                required
              />
            </div>
            {error ? <Aviso tono="alerta">{error}</Aviso> : null}
            <Button type="submit" disabled={cargando !== null} className="w-full justify-center">
              <LogIn className="h-4 w-4" />
              Ingresar
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <p className="text-[13px] font-semibold">Acceso rápido de demostración</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cada perfil ve exactamente lo que las políticas de la base le permiten.
          </p>
          <ul className="mt-4 space-y-2">
            {CUENTAS.map((c) => (
              <li key={c.email}>
                <button
                  onClick={() => void entrar(c.email, CLAVE_DEMO)}
                  disabled={cargando !== null}
                  className="flex w-full items-center justify-between rounded-[6px] border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-muted disabled:opacity-60"
                >
                  <span>
                    <span className="block text-[13px] font-semibold">{c.nombre}</span>
                    <span className="block text-[11px] text-muted-foreground num">{c.email}</span>
                  </span>
                  <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-semibold">
                    {c.rol}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
