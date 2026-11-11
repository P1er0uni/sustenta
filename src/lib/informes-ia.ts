import { sustenta } from "@/integrations/sustenta/client";
import { leerInformeIA } from "@/lib/analizar";

/**
 * Token de Supabase de la sesión activa. Las server fns de informes IA actúan
 * con este token para leer/escribir en Storage con los permisos del usuario
 * (RLS) — no hay claves de servidor nuevas.
 */
export async function tokenSesion(): Promise<string> {
  const { data } = await sustenta.auth.getSession();
  return data.session?.access_token ?? "";
}

function base64ABytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Abre un informe IA (HTML o PDF) en una pestaña nueva, descargándolo por la
 * server fn (funciona igual en local y en Vercel). Con `imprimir` (informes
 * aprobados sin PDF — Vercel), el HTML se abre con un botón para imprimirlo
 * y guardarlo como PDF.
 */
export async function abrirInforme(archivo: string, token: string, imprimir = false): Promise<void> {
  const res = await leerInformeIA({ data: { archivo, token } });
  if (!res.ok || !res.contenidoBase64) throw new Error(res.error ?? "Informe no encontrado.");
  const mime = res.tipoMime ?? "application/octet-stream";
  let contenido: BlobPart = base64ABytes(res.contenidoBase64);
  if (imprimir && mime.startsWith("text/html")) {
    contenido = new TextDecoder()
      .decode(base64ABytes(res.contenidoBase64))
      .replace(
        "</body>",
        `<div style="position:fixed;top:12px;right:12px;z-index:99"><button onclick="window.print()" style="padding:8px 14px;border:0;border-radius:6px;background:#0F6E56;color:#fff;font:600 12px 'Segoe UI',Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)">Imprimir / guardar PDF</button></div>\n</body>`,
      );
  }
  const url = URL.createObjectURL(new Blob([contenido], { type: mime }));
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
