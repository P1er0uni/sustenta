// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Dev: sirve /informes/* (informes del agente de sustentos) leyendo del disco en
 * cada request. El middleware estático de public/ cachea el listado de archivos,
 * así que un HTML recién escrito por el agente daba 404 durante ~2 segundos —
 * justo cuando el popup del editor lo pide al terminar la generación. Este
 * middleware corre ANTES del estático, sin cache: el informe existe en el mismo
 * instante en que el agente lo escribe. En build no hace falta: los archivos de
 * public/ se copian al dist antes de servir cualquier request.
 */
function informesDirectos() {
  return {
    name: "sustenta-informes-directos",
    configureServer(server: { config: { root: string }; middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/(informes|expedientes)\/([^/?]+)$/.exec(req.url ?? "");
        if (!m) return next();
        const dir = m[1] ?? "informes";
        let nombre = "";
        try {
          nombre = decodeURIComponent(m[2] ?? "");
        } catch {
          return next();
        }
        // Solo nombres planos con extensión permitida: sin barras, sin "..".
        if (!/^[\w .-]+\.(html|pdf|json)$/i.test(nombre)) return next();
        try {
          const contenido = readFileSync(
            join(resolve(server.config.root, "public", dir), nombre),
          );
          const tipo = /\.pdf$/i.test(nombre)
            ? "application/pdf"
            : /\.json$/i.test(nombre)
              ? "application/json"
              : "text/html; charset=utf-8";
          const r = res as { setHeader: (k: string, v: string) => void; end: (b: Buffer) => void };
          r.setHeader("Content-Type", tipo);
          r.setHeader("Cache-Control", "no-store");
          r.end(contenido);
        } catch {
          next(); // todavía no existe: sigue la cadena (404 normal)
        }
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [informesDirectos()],
  },
});
