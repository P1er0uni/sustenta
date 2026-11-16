import { createServerFn } from "@tanstack/react-start";

/**
 * Server fns de la base de conocimiento (RAG — spec 002).
 *
 * El índice vive en Supabase Storage (archivos rag-*.rag junto a los informes
 * IA), así que no hay tabla ni SQL: todo actúa con el access_token de Supabase
 * que el navegador pasa (mismo patrón que los informes IA) y hereda los
 * permisos RLS del usuario logueado, sin claves nuevas. Los embeddings los
 * calcula Gemini (GEMINI_API_KEY); sin credenciales, la página lo explica
 * en claro.
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
  /** "embeddings" = falta la GEMINI_API_KEY; "otro" = error de Storage/red. */
  motivo?: "embeddings" | "otro";
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
      const motivo: BuscarConocimientoResultado["motivo"] = /no configurado|GEMINI_API_KEY/i.test(mensaje)
        ? "embeddings"
        : "otro";
      return { ok: false, error: mensaje, motivo };
    }
  });

interface EstadoConocimientoInput {
  token?: string;
}

interface EstadoConocimientoResultado {
  /** true si Gemini (embeddings del RAG) tiene su API key configurada. */
  configurado: boolean;
  /** Informes indexados en la base (archivos .rag en Storage; 0 si aún no hay). */
  informes: number;
  error?: string;
}

export const estadoConocimiento = createServerFn({ method: "POST" })
  .validator((input: EstadoConocimientoInput) => input)
  .handler(async ({ data }): Promise<EstadoConocimientoResultado> => {
    try {
      // embeddingsConfigurados viene de embeddings.mjs (rag.mjs lo importa, no lo re-exporta).
      const { embeddingsConfigurados } = await import("../../agente-sustentos/src/embeddings.mjs");
      if (!data.token) return { configurado: embeddingsConfigurados(), informes: 0 };
      const { estadoIndice } = await import("../../agente-sustentos/src/rag.mjs");
      const { informes } = await estadoIndice(data.token);
      return { configurado: embeddingsConfigurados(), informes };
    } catch (e) {
      // Storage inaccesible u otro error: la página lo explica en claro.
      let configurado = false;
      try {
        const { embeddingsConfigurados } = await import("../../agente-sustentos/src/embeddings.mjs");
        configurado = embeddingsConfigurados();
      } catch {
        // sin config legible, queda false
      }
      return { configurado, informes: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
