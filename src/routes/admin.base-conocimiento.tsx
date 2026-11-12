import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Search } from "lucide-react";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Num, Vacio } from "@/components/ui-kit";
import { abrirInforme, tokenSesion } from "@/lib/informes-ia";
import {
  buscarConocimiento,
  estadoConocimiento,
  type FragmentoConocimiento,
} from "@/lib/base-conocimiento";

export const Route = createFileRoute("/admin/base-conocimiento")({
  head: () => ({
    meta: [
      { title: "Base de conocimiento — Sustenta" },
      {
        name: "description",
        content:
          "Búsqueda semántica sobre los informes IA generados: la memoria de sustentos que consulta el análisis de cada envío.",
      },
      { property: "og:title", content: "Base de conocimiento — Sustenta" },
      {
        property: "og:description",
        content: "Búsqueda semántica sobre los informes IA generados (RAG).",
      },
    ],
  }),
  component: BaseConocimiento,
});

/** Stopwords del español: no se resaltan ni buscan (evita centrar el snippet
 *  en "de", "la", "en"…). */
const STOPWORDS = new Set([
  "de", "la", "el", "en", "con", "que", "los", "las", "del", "al", "un", "una",
  "y", "o", "a", "por", "para", "se", "su", "es", "son", "fue", "ser", "mas",
  "como", "esta", "este", "esto", "estas", "estos", "pero", "sin", "sobre",
]);

/** Extrae un snippet corto del fragmento centrado en la primera coincidencia
 *  de un término de la consulta, con los términos resaltados — como un motor
 *  de búsqueda: la parte relevante al buscar, no el documento entero. */
function snippet(texto: string, consulta: string, max = 180): ReactNode {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const terminos = Array.from(
    new Set(
      (consulta.toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)),
    ),
  );
  // Primera aparición de cualquier término significativo en el fragmento.
  const lower = t.toLowerCase();
  let pos = -1;
  for (const term of terminos) {
    const i = lower.indexOf(term);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  let inicio = pos >= 0 ? Math.max(0, pos - 50) : 0;
  let fin = Math.min(t.length, inicio + max);
  // No cortar a mitad de palabra en los bordes.
  if (inicio > 0) {
    const esp = t.indexOf(" ", inicio);
    if (esp >= 0 && esp < fin) inicio = esp + 1;
  }
  if (fin < t.length) {
    const esp = t.lastIndexOf(" ", fin);
    if (esp > inicio) fin = esp;
  }
  const prefijo = inicio > 0 ? "…" : "";
  const sufijo = fin < t.length ? "…" : "";
  const recorte = t.slice(inicio, fin).trim();
  if (!recorte) return null;
  if (!terminos.length) return `${prefijo}${recorte}${sufijo}`;
  const esc = terminos.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${esc.join("|")})`, "gi");
  const partes = recorte.split(regex).filter(Boolean);
  return (
    <>
      {prefijo}
      {partes.map((p, i) =>
        terminos.includes(p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-accent-soft px-0.5 font-semibold text-accent">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {sufijo}
    </>
  );
}

function BaseConocimiento() {
  const [consulta, setConsulta] = useState("");
  const [buscado, setBuscado] = useState("");

  const estadoQ = useQuery({
    queryKey: ["base-conocimiento-estado"],
    queryFn: async () => estadoConocimiento({ data: { token: await tokenSesion() } }),
  });

  const buscarM = useMutation({
    mutationFn: async () => {
      const texto = consulta.trim();
      if (!texto) return { ok: true as const, resultados: [] as FragmentoConocimiento[] };
      return buscarConocimiento({ data: { consulta: texto, token: await tokenSesion() } });
    },
    onSuccess: () => setBuscado(consulta.trim()),
  });

  const abrirM = useMutation({
    mutationFn: async (fuente: string) => {
      const token = await tokenSesion();
      const pdf = fuente.replace(/\.html$/i, ".pdf");
      try {
        await abrirInforme(pdf, token);
      } catch {
        // Si no hay PDF (p. ej. informe sin PDF en Vercel), abrir el HTML.
        await abrirInforme(fuente, token);
      }
    },
  });

  const estado = estadoQ.data;
  const resultados = buscarM.data?.ok ? (buscarM.data.resultados ?? []) : null;
  const errorBusqueda = buscarM.data && !buscarM.data.ok ? buscarM.data : null;

  return (
    <AppShell>
      <PageHeader
        titulo="Base de conocimiento"
        descripcion="Los informes IA generados se indexan aquí; el análisis de cada envío consulta esta base y la búsqueda encuentra fragmentos por significado (RAG)."
      />

      <div className="mb-4 space-y-3">
        {estadoQ.isLoading ? (
          <Vacio mensaje="Cargando estado de la base…" />
        ) : estado && !estado.configurado ? (
          <Aviso tono="info" titulo="IA de embeddings sin configurar">
            La base de conocimiento necesita el MaaS de Huawei: define <code>MAAS_API_KEY</code> y{" "}
            <code>MAAS_BASE_URL</code> (el access point del despliegue) en el entorno del servidor — o{" "}
            <code>MAAS_PROVEEDOR=gemini</code> para probar con la clave de Gemini. Mientras falten, la app
            funciona igual — sin indexado ni búsqueda.
          </Aviso>
        ) : estado && estado.error ? (
          <Aviso tono="alerta" titulo="No se pudo leer la base de conocimiento">
            {estado.error}
          </Aviso>
        ) : estado && estado.informes === 0 ? (
          <Aviso tono="info" titulo="La base de conocimiento está vacía">
            Aún no hay informes indexados. Con el MaaS de Huawei configurado, cada informe IA generado
            queda indexado automáticamente; para los que ya existen, corre el backfill del agente
            (<code>rag-backfill.mjs</code>).
          </Aviso>
        ) : estado ? (
          <Aviso tono="neutro">
            <Num>{estado.informes}</Num> informe(s) indexado(s) en la base de conocimiento.
          </Aviso>
        ) : null}
      </div>

      <Card>
        <CardHeader
          titulo="Búsqueda semántica"
          descripcion="Escribe qué buscas por significado — no hace falta el nombre exacto ni la fecha."
        />
        <form
          className="flex gap-2 border-b border-border px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            buscarM.mutate();
          }}
        >
          <input
            className="field flex-1"
            placeholder="p. ej. reuniones de coordinación en octubre"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          />
          <Button type="submit" variante="primario" cargando={buscarM.isPending} className="gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Buscar
          </Button>
        </form>

        {errorBusqueda ? (
          <div className="px-4 py-3">
            {errorBusqueda.motivo === "maas" ? (
              <Aviso tono="info" titulo="IA de embeddings sin configurar">
                Faltan las credenciales de embeddings (<code>MAAS_API_KEY</code>/<code>MAAS_BASE_URL</code> o{" "}
                <code>MAAS_PROVEEDOR=gemini</code> con <code>GEMINI_API_KEY</code>).
              </Aviso>
            ) : (
              <Aviso tono="alerta" titulo="La búsqueda falló">
                {errorBusqueda.error}
              </Aviso>
            )}
          </div>
        ) : resultados === null ? null : resultados.length === 0 ? (
          <Vacio
            mensaje={
              buscado
                ? `Sin fragmentos parecidos a “${buscado}”. A medida que se generen informes IA, quedarán indexados aquí.`
                : "Escribe una consulta y presiona Buscar."
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {resultados.map((f, i) => {
              const cargando = abrirM.isPending && abrirM.variables === f.fuente;
              return (
                <li key={`${f.fuente}-${i}`} className="flex gap-3 px-4 py-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => abrirM.mutate(f.fuente)}
                        disabled={cargando}
                        title="Abrir el informe en PDF"
                        className="truncate text-left text-[13px] font-semibold text-accent hover:underline disabled:opacity-60"
                      >
                        {f.fuente.replace(/\.html$/i, "")}
                      </button>
                      <Badge tono="acento">{Math.round(f.similitud * 100)}%</Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {f.colaborador ?? "—"}
                      {f.fecha ? ` · ${f.fecha}` : ""}
                      {cargando ? " · abriendo…" : ""}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
                      {snippet(f.texto, buscado)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
