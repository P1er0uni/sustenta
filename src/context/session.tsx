import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { Colaborador, Periodo, Rol } from "@/integrations/sustenta/types";

interface SesionCtx {
  session: Session | null;
  autenticando: boolean;
  colaborador: Colaborador | null;
  rol: Rol;
  periodoActivo: Periodo | null;
  periodos: Periodo[];
  cargando: boolean;
  configurado: boolean;
  cerrarSesion: () => Promise<void>;
}

const Ctx = createContext<SesionCtx | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [autenticando, setAutenticando] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let activo = true;
    const { data: sub } = sustenta.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      setAutenticando(false);
    });
    sustenta.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSession(data.session);
      setAutenticando(false);
    });
    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  // El colaborador activo sale de la propia sesión: RLS decide qué filas se ven.
  const colaboradorQ = useQuery({
    queryKey: ["colaborador-activo", userId],
    enabled: sustentaConfigurado && !!userId,
    queryFn: async () => {
      const { data, error } = await sustenta
        .from("hr_colaborador")
        .select("*")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Colaborador | null;
    },
  });

  const periodosQ = useQuery({
    queryKey: ["periodos", userId],
    enabled: sustentaConfigurado && !!userId,
    queryFn: async () => {
      const { data, error } = await sustenta.from("hr_periodo").select("*").limit(60);
      if (error) throw error;
      return (data ?? []) as Periodo[];
    },
  });

  const periodos = useMemo(() => {
    const lista = [...(periodosQ.data ?? [])];
    lista.sort((a, b) =>
      String(b.fecha_inicio ?? b.codigo ?? "").localeCompare(String(a.fecha_inicio ?? a.codigo ?? "")),
    );
    return lista;
  }, [periodosQ.data]);

  const periodoActivo = useMemo(
    () => periodos.find((p) => (p.estado ?? "").toLowerCase() === "abierto") ?? periodos[0] ?? null,
    [periodos],
  );

  const colaborador = colaboradorQ.data ?? null;

  const valor: SesionCtx = {
    session,
    autenticando,
    colaborador,
    rol: (colaborador?.rol as Rol) ?? "colaborador",
    periodoActivo,
    periodos,
    cargando: colaboradorQ.isLoading || periodosQ.isLoading,
    configurado: sustentaConfigurado,
    cerrarSesion: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await sustenta.auth.signOut();
    },
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion(): SesionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSesion debe usarse dentro de SesionProvider");
  return ctx;
}
