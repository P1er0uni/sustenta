# Plan 002 — RAG: base de conocimiento de informes aprobados

> Derivado de `spec.md`.

## Arquitectura

```
                    ┌── indexado (al generar el informe) ──────────────────────────┐
                    │                                                              ▼
analizarEnvio ────► indexarInforme (rag.mjs) ──► incrustar (maas.mjs) ──► Storage: informes-ia/rag-<informe>.rag
(analizar.ts)         htmlATexto + fragmentar          MaaS Huawei                  ▲
Vercel y local        (try/catch: nunca rompe                                        │
                      la generación)                                                 │
                                                                                    │
  consulta (RAG en el análisis) ────────────────────────────────────────────────────┤
    Vercel: analizarEnvio ─► recuperarContextoEnvio (rag.mjs) ─► listar + bajar     │
    Local:  cli.mjs --lote ─┘        los .rag + similitud coseno en JS              │
        │                           (query = colaborador + actividades)             │
        └─► contexto ─► consultarGeminiResumen (prompt + sección CONTEXTO)          │
                    └─► informe HTML: sección "Contexto consultado"                │
                                                                                     │
  búsqueda UI ──────────────────────────────────────────────────────────────────────┘
    admin.base-conocimiento ─► server fn buscarConocimiento ─► buscar (rag.mjs) ─────┘
```

- **Dos caminos de análisis** (Vercel: `lote.mjs` importado; local: `cli.mjs --lote`) convergen en
  `consultarGeminiResumen` y en el constructor del informe (`informe.mjs`): ambos reciben `contexto`
  y lo pasan igual. La recuperación vive una sola vez en `rag.mjs`
  (`recuperarContextoEnvio`), invocada desde cada camino.
- **Token del usuario** en todas las operaciones Supabase (mismo patrón que `informes-ia/`): Vercel
  pasa `data.token`; local lo pasa el server fn al CLI como env `SUPABASE_TOKEN`.
- **Degradación elegante en cada capa**: sin `MAAS_API_KEY`, sin token o con error del MaaS → el
  paso se omite, se loguea, y el flujo principal (aprobar / analizar / navegar) sigue igual.

## Archivos

| Acción | Ruta | Propósito |
|--------|------|-----------|
| crear | `specs/002-rag-base-conocimiento/sql/001_rag_chunks.sql` | **Migración futura** a pgvector (NO ejecutar: el índice vive en Storage) |
| crear | `agente-sustentos/src/maas.mjs` | Adaptador MaaS de Huawei: `maasConfigurado()`, `incrustar(textos)` (única costura si el formato real difiere del supuesto OpenAI-compatible) |
| crear | `agente-sustentos/src/rag.mjs` | Núcleo RAG: `htmlATexto`, `fragmentar`, `similitudCoseno`, `indexarInforme`, `recuperarContextoEnvio`, `buscar`, `estadoIndice`, `fuentesExistentes` (archivos `.rag` en Storage con token+anon) |
| crear | `agente-sustentos/src/rag-backfill.mjs` | Script manual: indexa los informes que ya existen (local: manifest de `public/informes`; con token por env) |
| crear | `src/lib/base-conocimiento.ts` | Server fns: `buscarConocimiento({consulta, token})`, `estadoConocimiento({token})` (conteo + ¿MaaS configurado?) |
| crear | `src/routes/admin.base-conocimiento.tsx` | Página de búsqueda semántica |
| modificar | `agente-sustentos/src/config.mjs` | Leer `MAAS_PROVEEDOR`, `MAAS_API_KEY`, `MAAS_BASE_URL`, `MAAS_EMBEDDING_MODEL`, `MAAS_EMBEDDING_DIMS` (reusa `leerEnv()` + `limpiar()`); bump `VERSION_PROMPT` |
| modificar | `agente-sustentos/src/gemini.mjs` (antes openai.mjs) | `INSTRUCCION_SISTEMA_RESUMEN`: sección "CONTEXTO DE REFERENCIA" con regla explícita (es material de referencia, NO evidencia del envío; no inventar citas sobre él) |
| modificar | `agente-sustentos/src/informe.mjs` | `construirHtmlLote` + `generarInformeLote`: sección "Contexto consultado" (fuente, fecha, extracto, similitud) cuando hay contexto |
| modificar | `agente-sustentos/src/lote.mjs` | `analizarEnvioLote` acepta `contexto` y lo pasa a `consultarGeminiResumen` y a `construirHtmlLote` |
| modificar | `agente-sustentos/src/cli.mjs` | `--lote`: recuperar contexto (env `SUPABASE_TOKEN`) y pasarlo a `consultarGeminiResumen`/`generarInformeLote` |
| modificar | `src/lib/analizar.ts` | `analizarEnvio` (ambas ramas): indexar tras publicar el informe (try/catch, log). Vercel pasa `token` a `analizarEnvioLote`; local pasa `SUPABASE_TOKEN` al spawn |
| modificar | `src/lib/nav.ts` | Entrada "Base de conocimiento" (siguiendo el patrón de nav admin existente) |

## Estado y datos

- **Índice en Storage** (bucket `sustentos`, carpeta `informes-ia/`, la misma que los informes): un
  archivo `rag-<informe>.rag` por informe con `{version, fuente, tipo, colaborador, fecha,
  creado_at, chunks: [{texto, embedding}]}`. La extensión `.rag` es a propósito: el código que
  reconstruye el manifest ignora todo lo que no sea `.json`, así que no contamina la lista de
  informes. Hereda las políticas RLS del bucket (solo usuarios autenticados; append-only) — cero
  SQL, cero tablas nuevas.
- **Búsqueda**: listar `rag-*.rag` → bajar → incrustar la consulta (1 llamada al MaaS) → similitud
  coseno en JS → top-k. Con decenas de informes es imperceptible (~80KB por informe indexado);
  pgvector (SQL de la spec) es la migración si algún día hace falta escalar.
- **Sin lógica de negocio en el cliente**: la página llama a server fns; nada de fetch directo al
  MaaS ni a Supabase desde el navegador.
- **React Query** en la página: búsqueda como mutation con estados loading/resultado/error; el
  estado inicial (`estadoConocimiento`) como query con `staleTime` corto.

## UI

Página `admin.base-conocimiento` (rol administrativo, patrón de las demás `admin.*`):

- **Estado inicial:** tarjeta con el estado de la base (N informes indexados) y el buscador.
- **Búsqueda:** input + botón "Buscar" (Enter también). Resultados como tarjetas: fuente (informe),
  colaborador, fecha, extracto del fragmento y % de similitud. Botón/enlace para abrir el informe
  origen cuando exista en el manifest (reusa `leerInformeIA`).
- **Estados especiales:** MaaS sin configurar → aviso con las variables que faltan (sin error crudo);
  índice vacío → aviso "aún no hay informes indexados" (backfill); sin resultados → mensaje vacío;
  error del MaaS/Storage → aviso con el mensaje real.
- Identidad visual del README: tokens de color, Montserrat, lucide-react.

## Riesgos y mitigaciones

- **Formato real del MaaS desconocido** → todo vive en `maas.mjs` (adapter único); supuesto
  documentado (embeddings estilo OpenAI); tarea de verificación al llegar las credenciales; si
  difiere, solo se reescribe el interior de `incrustar`. Mientras tanto, `MAAS_PROVEEDOR=gemini`
  permite probar el pipeline completo con la clave de Gemini (migración del 2026-11-11; la clave
  OpenAI expiró).
- **Escala del índice en Storage** → cada búsqueda baja todos los `.rag` (~80KB por informe):
  imperceptible con decenas de informes; si la base crece, migrar a pgvector con el SQL de la spec
  (la base es re-generable con el backfill).
- **BOM en env vars de Vercel** (ya ocurrió con `OPENAI_API_KEY`) → `limpiar()` en config.mjs para
  todas las vars MaaS.
- **Indexación rompa la generación del informe** → try/catch + log en `analizarEnvio`; nunca propaga
  (el informe se publica primero, el indexado es mejor esfuerzo).
- **Latencia en Vercel (timeout 300s)** → indexado = 1 llamada embeddings (batch) + 1 subida; se
  ejecuta tras publicar el informe y en paralelo donde se pueda.
- **RLS del bucket** → el índice usa la misma carpeta y políticas que los informes IA (ya probadas
  en producción); sin políticas nuevas ni SQL.
- **Costo** → embeddings solo al generar/analizar/buscar; despreciable frente al LLM de análisis.

## Verificación

1. **Sin MaaS (hoy):** generar un informe de envío local → generación OK + log "RAG omitido"; el
   informe es idéntico a hoy, sin sección de contexto; página de búsqueda → aviso de configuración.
   (Cubre los EARS de degradación.)
2. **Con MaaS (al llegar la key):** generar un informe → un archivo `rag-<informe>.rag` nuevo en
   Storage (dashboard → Storage → `sustentos` → `informes-ia/`); generar otro informe del mismo
   colaborador → el resumen ejecutivo menciona el historial y el HTML muestra "Contexto consultado";
   buscar "…" → fragmentos ordenados por similitud. (Cubre los EARS de indexado, consulta y
   búsqueda.)
3. **Backfill:** correr `rag-backfill.mjs` → los informes históricos aparecen en la búsqueda.
4. **Vercel:** `vercel env add` de las vars MaaS + deploy → repetir 2 en producción.
5. **RLS:** con sesión de colaborador (no admin), la página de búsqueda no expone nada que RLS no
   permita (el bucket es authenticated; el acceso a la página sigue el patrón admin).
