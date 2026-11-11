import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AccountInfo } from "@azure/msal-browser";

import {
  cuentaMicrosoftActiva,
  conectarMicrosoft,
  desconectarMicrosoft,
  etiquetaCuenta,
  msConfigurado,
} from "@/integrations/microsoft/client";
import { mensajeDeError } from "@/integrations/sustenta/client";

const CLAVE_DEMO = "sustenta.ms.demo";

interface MicrosoftCtx {
  /** Correo/nombre de la cuenta de Microsoft conectada, si la hay. */
  cuenta: string | null;
  cargandoCuenta: boolean;
  conectando: boolean;
  /** Modo demo: reuniones de ejemplo cuando no hay cuenta conectada. */
  modoDemo: boolean;
  puedeDemo: boolean;
  configurado: boolean;
  conectar: () => Promise<void>;
  desconectar: () => Promise<void>;
  alternarDemo: () => void;
}

const Ctx = createContext<MicrosoftCtx | null>(null);

export function MicrosoftProvider({ children }: { children: ReactNode }) {
  const [cuentaInfo, setCuentaInfo] = useState<AccountInfo | null>(null);
  const [cargandoCuenta, setCargandoCuenta] = useState(msConfigurado);
  const [conectando, setConectando] = useState(false);
  const [modoDemo, setModoDemo] = useState(() => {
    try {
      return sessionStorage.getItem(CLAVE_DEMO) === "1";
    } catch {
      return false;
    }
  });
  const qc = useQueryClient();

  useEffect(() => {
    let activo = true;
    if (!msConfigurado) return;
    cuentaMicrosoftActiva().then((cuenta) => {
      if (!activo) return;
      setCuentaInfo(cuenta);
      setCargandoCuenta(false);
    });
    return () => {
      activo = false;
    };
  }, []);

  const cuenta = useMemo(() => etiquetaCuenta(cuentaInfo), [cuentaInfo]);

  const refrescarReuniones = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["reuniones"] });
  }, [qc]);

  const conectar = useCallback(async () => {
    setConectando(true);
    try {
      const cuentaNueva = await conectarMicrosoft();
      setCuentaInfo(cuentaNueva);
      setModoDemo(false);
      try {
        sessionStorage.removeItem(CLAVE_DEMO);
      } catch {
        /* sin sesión persistente: irrelevante */
      }
      toast.success(`Outlook conectado: ${etiquetaCuenta(cuentaNueva) ?? "cuenta activa"}`);
      await refrescarReuniones();
    } catch (error) {
      toast.error(mensajeDeError(error));
    } finally {
      setConectando(false);
    }
  }, [refrescarReuniones]);

  const desconectar = useCallback(async () => {
    await desconectarMicrosoft();
    setCuentaInfo(null);
    toast.success("Outlook desconectado");
    await refrescarReuniones();
  }, [refrescarReuniones]);

  const alternarDemo = useCallback(() => {
    setModoDemo((previo) => {
      const nuevo = !previo;
      try {
        if (nuevo) sessionStorage.setItem(CLAVE_DEMO, "1");
        else sessionStorage.removeItem(CLAVE_DEMO);
      } catch {
        /* sin sesión persistente: irrelevante */
      }
      void qc.invalidateQueries({ queryKey: ["reuniones"] });
      return nuevo;
    });
  }, [qc]);

  const valor: MicrosoftCtx = {
    cuenta,
    cargandoCuenta,
    conectando,
    modoDemo: modoDemo && !cuenta,
    puedeDemo: !cuenta,
    configurado: msConfigurado,
    conectar,
    desconectar,
    alternarDemo,
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useCuentaMicrosoft(): MicrosoftCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCuentaMicrosoft debe usarse dentro de MicrosoftProvider");
  return ctx;
}
