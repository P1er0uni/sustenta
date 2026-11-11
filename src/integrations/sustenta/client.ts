import { createClient } from "@supabase/supabase-js";

/**
 * Proyecto Supabase existente de Sustenta.
 * El esquema de negocio es `horas` (no `public`).
 * La clave publicable (anon) es pública por diseño.
 */
export const SUSTENTA_SUPABASE_URL =
  (import.meta.env["VITE_SUSTENTA_SUPABASE_URL"] as string | undefined) ??
  "https://gjgezgdnpecyffjpxdep.supabase.co";

export const SUSTENTA_SUPABASE_ANON_KEY =
  (import.meta.env["VITE_SUSTENTA_SUPABASE_ANON_KEY"] as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZ2V6Z2RucGVjeWZmanB4ZGVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxNTcyNDgsImV4cCI6MjA2ODczMzI0OH0.OsAQ8hbjU0x-Ya3JZXwWz117KD961NHksrwnB8FtVTw";

export const sustentaConfigurado = SUSTENTA_SUPABASE_ANON_KEY.length > 0;

export const sustenta = createClient(SUSTENTA_SUPABASE_URL, SUSTENTA_SUPABASE_ANON_KEY || "sin-clave", {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "sustenta.auth" },
});

/** Cliente sobre el esquema público de Storage/otros helpers. */
export const sustentaStorage = sustenta.storage;

/** Devuelve el mensaje de la base tal cual, sin reinterpretarlo. */
export function mensajeDeError(error: unknown): string {
  if (!error) return "Error desconocido";
  if (typeof error === "string") return error;
  const e = error as { message?: string; details?: string; hint?: string };
  return e.message || e.details || e.hint || "Error desconocido";
}
