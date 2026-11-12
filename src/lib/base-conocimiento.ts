import { createServerFn } from "@tanstack/react-start";

/**
 * Server fns de la base de conocimiento (RAG — spec 002).
 *
 * El índice vive en Supabase Storage (archivos rag-*.rag junto a los informes
 * IA), así que no hay tabla ni SQL: todo actúa con el access_token de Supabase
 * que el navegador pasa (mismo patrón que los informes IA) y hereda los
 * permisos RLS del usuario logueado, sin claves nuevas. Los embeddings los
 * calcula el proveedor activo (MaaS de Huawei en producción; Gemini para
 * pruebas con MAAS_PROVEEDOR=gemini); sin credenciales, la página lo
 * explica en claro.
 */

export interface FragmentoConocimiento {
  fuente: string;
  tipo: string;
  colaborador: string | null;
  fecha: string | null;
  texto: string;
  similitud: number;
}

interface BuscarConocimientoInput {
  consulta: string;
  token?: string;
}

interface BuscarConocimientoResultado {
  ok: boolean;
  resultados?: FragmentoConocimiento[];
  error?: string;
  /** "maas" = falta configurar el MaaS; "otro" = error de Storage/red. */
  motivo?: "maas" | "otro";
}

export const buscarConocimiento = createServerFn({ method: "POST" })
  .validator((input: BuscarConocimientoInput) => input)
  .handler(async ({ data }): Promise<BuscarConocimientoResultado> => {
    const consulta = (data.consulta ?? "").trim();
    if (!consulta) return { ok: true, resultados: [] };
    try {
      const { buscar } = await import("../../agente-sustentos/src/rag.mjs");
      const resultados = await buscar({ consulta, token: data.token, k: 8 });
      return { ok: true, resultados };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const motivo: BuscarConocimientoResultado["motivo"] = /MaaS|MAAS/i.test(mensaje) ? "maas" : "otro";
      return { ok: false, error: mensaje, motivo };
    }
  });

interface EstadoConocimientoInput {
  token?: string;
}

interface EstadoConocimientoResultado {
  /** true si el MaaS de Huawei tiene API key y access point configurados. */
  configurado: boolean;
  /** Informes indexados en la base (archivos .rag en Storage; 0 si aún no hay). */
  informes: number;
  error?: string;
}

export const estadoConocimiento = createServerFn({ method: "POST" })
  .validator((input: EstadoConocimientoInput) => input)
  .handler(async ({ data }): Promise<EstadoConocimientoResultado> => {
    try {
      // maasConfigurado viene de maas.mjs (rag.mjs lo importa, no lo re-exporta).
      const { maasConfigurado } = await import("../../agente-sustentos/src/maas.mjs");
      if (!data.token) return { configurado: maasConfigurado(), informes: 0 };
      const { estadoIndice } = await import("../../agente-sustentos/src/rag.mjs");
      const { informes } = await estadoIndice(data.token);
      return { configurado: maasConfigurado(), informes };
    } catch (e) {
      // Storage inaccesible u otro error: la página lo explica en claro.
      let configurado = false;
      try {
        const { maasConfigurado } = await import("../../agente-sustentos/src/maas.mjs");
        configurado = maasConfigurado();
      } catch {
        // sin config legible, queda false
      }
      return { configurado, informes: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
