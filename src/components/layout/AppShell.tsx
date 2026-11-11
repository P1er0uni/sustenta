import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
  Eye,
  CircleDot,
  AlertCircle,
  LogOut,
  Menu,
  X,
  User,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { gruposPorRol, ROLES } from "@/lib/nav";
import { useSesion } from "@/context/session";
import { nombreColaborador, nombrePeriodo } from "@/integrations/sustenta/types";
import { sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { AlertaFila } from "@/integrations/sustenta/vistas";
import { Badge, Num } from "@/components/ui-kit";

function Sidebar({
  colapsada = false,
  onColapsar,
  onNavegar,
  onCerrar,
  movil = false,
}: {
  colapsada?: boolean;
  onColapsar?: () => void;
  onNavegar?: () => void;
  onCerrar?: () => void;
  movil?: boolean;
}) {
  const { rol } = useSesion();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const grupos = useMemo(() => gruposPorRol(rol), [rol]);
  const [abiertos, setAbiertos] = useState<string[]>([]);

  useEffect(() => {
    setAbiertos(grupos.map((g) => g.id));
  }, [grupos]);

  const compacta = colapsada && !movil;

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        compacta ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-sidebar-border px-4 py-4",
          compacta && "justify-center px-2",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-accent">
          <ShieldCheck className="h-4 w-4 text-accent-foreground" />
        </span>
        {compacta ? null : (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold text-white">Sustenta</p>
            <p className="text-[11px] text-sidebar-muted">Claro Empresas</p>
          </div>
        )}
        {movil ? (
          <button
            onClick={onCerrar}
            aria-label="Cerrar menú"
            className="rounded-[6px] p-1.5 text-sidebar-muted hover:bg-sidebar-elevated hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-2 py-3">
        {grupos.map((grupo) => {
          const abierto = abiertos.includes(grupo.id);
          return (
            <div key={grupo.id} className="mb-1">
              {compacta ? (
                <div className="mx-2 my-2 h-px bg-sidebar-border" />
              ) : (
                <button
                  onClick={() =>
                    setAbiertos((prev) =>
                      prev.includes(grupo.id)
                        ? prev.filter((g) => g !== grupo.id)
                        : [...prev, grupo.id],
                    )
                  }
                  className="flex w-full items-center justify-between rounded-[6px] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted hover:bg-sidebar-elevated"
                >
                  {grupo.label}
                  {abierto ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {abierto || compacta ? (
                <ul className="mt-0.5 space-y-0.5">
                  {grupo.items.map((item) => {
                    const activo = pathname === item.to;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          title={compacta ? item.label : undefined}
                          onClick={onNavegar}
                          className={cn(
                            "flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors",
                            compacta && "justify-center px-0",
                            activo
                              ? "bg-sidebar-elevated font-semibold text-white"
                              : "text-sidebar-foreground hover:bg-sidebar-elevated hover:text-white",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              activo ? "text-accent" : "text-sidebar-muted",
                            )}
                          />
                          {compacta ? null : item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-2 py-3">
        {onColapsar ? (
          <button
            onClick={onColapsar}
            title={colapsada ? "Expandir menú" : "Colapsar menú"}
            className={cn(
              "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[11px] text-sidebar-muted hover:bg-sidebar-elevated hover:text-white",
              compacta && "justify-center px-0",
            )}
          >
            {colapsada ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
            {compacta ? null : "Colapsar menú"}
          </button>
        ) : null}
        {compacta ? null : (
          <p className="px-2.5 pt-2 text-[11px] text-sidebar-muted">
            AC Corporativo del Perú S.A.C.
          </p>
        )}
      </div>
    </aside>
  );
}

function MenuUsuario() {
  const { colaborador, session, cerrarSesion, rol } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  return (
    <div className="relative sm:hidden" ref={ref}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label="Menú de usuario"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong text-muted-foreground hover:bg-surface-muted"
      >
        <User className="h-4 w-4" />
      </button>
      {abierto ? (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-[6px] border border-border bg-surface p-3 shadow-lg">
          <p className="text-[13px] font-semibold">{nombreColaborador(colaborador)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="capitalize">{rol}</span>
            {session?.user?.email ? ` · ${session.user.email}` : ""}
          </p>
          <button
            onClick={() => void cerrarSesion()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-border-strong px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-muted"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir
          </button>
        </div>
      ) : null}
    </div>
  );
}

function tonoSeveridad(sev?: string | null) {
  const s = (sev ?? "").toLowerCase();
  if (s === "critica")
    return { texto: "text-accent", fondo: "bg-accent-soft", etiqueta: "Crítica" };
  if (s === "importante")
    return { texto: "text-warning", fondo: "bg-warning-soft", etiqueta: "Importante" };
  return { texto: "text-muted-foreground", fondo: "bg-surface-muted", etiqueta: "Informativa" };
}

function Campana() {
  const { colaborador } = useSesion();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const alertasQ = useQuery({
    queryKey: ["alertas", colaborador?.id],
    enabled: sustentaConfigurado && !!colaborador?.id,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_v_alerta")
        .select("*")
        .eq("destinatario_id", colaborador?.id ?? "")
        .eq("resuelta", false);
      if (error) throw error;
      return (data ?? []) as AlertaFila[];
    },
  });

  const marcarLeida = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sustenta.rpc("hr_marcar_alerta_leida", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alertas"] }),
  });

  const alertas = alertasQ.data ?? [];
  const noLeidas = alertas.filter((a) => !a.leida_en).length;
  const orden = ["critica", "importante", "informativa"];
  const grupos = orden
    .map((sev) => ({
      sev,
      filas: alertas.filter((a) => (a.severidad ?? "informativa").toLowerCase() === sev),
    }))
    .filter((g) => g.filas.length > 0);

  return (
    <div className="relative" ref={caja}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label="Alertas"
        className="relative rounded-[6px] p-2 text-muted-foreground hover:bg-surface-muted"
      >
        <Bell className="h-4 w-4" />
        {noLeidas > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-foreground num">
            {noLeidas}
          </span>
        ) : null}
      </button>
      {abierto ? (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[320px] overflow-y-auto rounded-[6px] border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold">Alertas</p>
            <p className="text-[11px] text-muted-foreground">
              <Num>{noLeidas}</Num> sin leer de <Num>{alertas.length}</Num> vigentes
            </p>
          </div>
          {grupos.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-muted-foreground">
              No tienes alertas pendientes.
            </p>
          ) : (
            grupos.map((g) => {
              const tono = tonoSeveridad(g.sev);
              return (
                <div key={g.sev}>
                  <p
                    className={cn(
                      "px-3 py-1 text-[10px] font-bold uppercase tracking-[0.06em]",
                      tono.fondo,
                      tono.texto,
                    )}
                  >
                    {tono.etiqueta}
                  </p>
                  {g.filas.map((a, i) => (
                    <button
                      key={`${a.tipo_codigo}-${i}`}
                      onClick={() => {
                        if (a.tipo_codigo) marcarLeida.mutate(a.tipo_codigo);
                        setAbierto(false);
                        if (a.enlace) void navigate({ to: a.enlace });
                      }}
                      className={cn(
                        "block w-full border-b border-border px-3 py-2 text-left hover:bg-surface-muted",
                        !a.leida_en && "bg-surface",
                      )}
                    >
                      <p className={cn("text-[12px] font-semibold", tono.texto)}>
                        {a.titulo ?? a.tipo_nombre}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{a.detalle ?? ""}</p>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function Topbar({ onAbrirMenu }: { onAbrirMenu?: () => void }) {
  const { colaborador, session, cerrarSesion, periodoActivo, rol } = useSesion();
  const alcance = ROLES.find((r) => r.valor === rol);
  const estado = (periodoActivo?.estado ?? "—").toLowerCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {onAbrirMenu ? (
          <button
            onClick={onAbrirMenu}
            aria-label="Abrir menú"
            className="rounded-[6px] p-2 text-muted-foreground hover:bg-surface-muted lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <span className="label-xs hidden sm:inline">Periodo</span>
          <Num className="whitespace-nowrap text-[13px] font-semibold">
            {nombrePeriodo(periodoActivo)}
          </Num>
          <Badge tono={estado === "abierto" ? "exito" : estado === "cerrado" ? "neutro" : "alerta"}>
            <CircleDot className="h-3 w-3" />
            {periodoActivo?.estado ?? "sin periodo"}
          </Badge>
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
          <Eye className="h-3.5 w-3.5" />
          {alcance?.alcance ?? "Alcance limitado"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Campana />
        <MenuUsuario />
        <div className="hidden items-center gap-3 border-l border-border pl-3 sm:flex">
          <div className="text-right leading-tight">
            <p className="text-[13px] font-semibold">{nombreColaborador(colaborador)}</p>
            <p className="text-[11px] text-muted-foreground">
              <span className="capitalize">{rol}</span>
              {session?.user?.email ? ` · ${session.user.email}` : ""}
            </p>
          </div>
          <button
            onClick={() => void cerrarSesion()}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-border-strong px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-muted"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}

export interface AccionRapida {
  label: string;
  to?: string;
  contador?: number;
  onClick?: () => void;
}

export function PageHeader({
  titulo,
  descripcion,
  acciones = [],
}: {
  titulo: string;
  descripcion?: string;
  acciones?: AccionRapida[];
}) {
  return (
    <div className="mb-5">
      <h1 className="text-[22px] font-semibold text-foreground">{titulo}</h1>
      {descripcion ? <p className="mt-1 text-[13px] text-muted-foreground">{descripcion}</p> : null}
      {acciones.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {acciones.map((a) => {
            const contenido = (
              <>
                {a.label}
                {a.contador ? (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground num">
                    {a.contador}
                  </span>
                ) : null}
              </>
            );
            const clase =
              "inline-flex items-center gap-1.5 rounded-[6px] border border-border-strong bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:bg-surface-muted";
            return a.to ? (
              <Link key={a.label} to={a.to} className={clase}>
                {contenido}
              </Link>
            ) : (
              <button key={a.label} onClick={a.onClick} className={clase}>
                {contenido}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { configurado, session, autenticando } = useSesion();
  const navigate = useNavigate();
  const [menuMovil, setMenuMovil] = useState(false);
  const [colapsada, setColapsada] = useState(false);
  const alternarColapso = () => setColapsada((v) => !v);

  useEffect(() => {
    if (!autenticando && !session) navigate({ to: "/auth", replace: true });
  }, [autenticando, session, navigate]);

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-[13px] text-muted-foreground">Verificando sesión…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <div className="hidden lg:flex">
        <Sidebar colapsada={colapsada} onColapsar={alternarColapso} />
      </div>
      {menuMovil ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMenuMovil(false)}
          />
          <Sidebar
            movil
            onNavegar={() => setMenuMovil(false)}
            onCerrar={() => setMenuMovil(false)}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onAbrirMenu={() => setMenuMovil(true)} />
        {!configurado ? (
          <div className="flex items-center gap-2 border-b border-warning/20 bg-warning-soft px-5 py-2 text-[12px] text-warning">
            <AlertCircle className="h-4 w-4" />
            Falta la clave pública de la base de datos: la interfaz está lista pero no puede leer
            datos.
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
