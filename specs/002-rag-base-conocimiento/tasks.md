# Tasks 002 — RAG: base de conocimiento de informes aprobados

Tareas derivadas de `plan.md`. Marcar `[x]` al completar y anotar desviaciones bajo
"Notes". El orden respeta dependencias; dentro de una fase el orden es libre.

## Fase 0 — Base de datos (dashboard Supabase; la ejecuta el usuario)

> **Pivote (2026-11-11):** sin acceso para modificar la base de datos, el índice pasó a vivir en
> Storage (archivos `.rag` junto a los informes). El SQL queda como migración futura a pgvector.

- [x] 0.1 Redactar `sql/001_rag_chunks.sql` (extensión `vector`, tabla, RLS, RPC) — queda como
      migración futura, no se ejecuta.
- [x] 0.2 ~~Ejecutar el SQL~~ Ya no requerido: el índice vive en Storage, sin SQL ni tablas.

## Fase 1 — Adaptador MaaS (`maas.mjs` + config)

- [x] 1.1 `config.mjs`: leer `MAAS_API_KEY`, `MAAS_BASE_URL`, `MAAS_EMBEDDING_MODEL`,
      `MAAS_EMBEDDING_DIMS` con `leerEnv()` + `limpiar()`; exportar `maas` en `config`.
- [x] 1.2 `maas.mjs`: `maasConfigurado()` y `incrustar(textos)` vía endpoint embeddings
      OpenAI-compatible (SDK `openai` con `baseURL`); reintentos suaves; mensaje claro si 401/403.
- [x] 1.3 Prueba manual sin clave → `maasConfigurado() === false` y `incrustar` lanza error
      explicativo (cubierto en `test/rag.test.mjs`).
- [x] 1.4 `MAAS_PROVEEDOR=maas|gemini`: interruptor de proveedor para PRUEBAS con la clave de Gemini
      (`gemini-embedding-001`, 1024 dims) mientras llegan las credenciales del MaaS; el índice
      se etiqueta por proveedor (`rag-*.maas.rag`/`rag-*.gemini.rag`) para que el cambio no choque
      (el bucket es append-only) y la búsqueda use solo el activo.

## Fase 2 — Núcleo RAG (`rag.mjs`)

- [x] 2.1 `htmlATexto(html)` (quitar tags/entidades) y `fragmentar(texto)` (~1000 caracteres,
      solape ~150).
- [x] 2.2 `indexarInforme({ html, colaborador, fecha, fuente, token })`: texto → chunks →
      `incrustar` → archivo `rag-<informe>.rag` en Storage (misma carpeta que los informes,
      token + anon). Fallo → log, no throw.
- [x] 2.3 `recuperarContextoEnvio({ colaborador, fecha, registros, token })`: arma la consulta
      (colaborador + actividades/proyecto), incrusta, lista y baja los `.rag`, puntúa con
      similitud coseno en JS (k=4). Sin configuración/token/error → `[]`.
- [x] 2.4 `buscar({ consulta, token, k })`, `estadoIndice(token)` y `fuentesExistentes(token)`
      para la página y el backfill.
- [x] 2.5 Pruebas en `test/rag.test.mjs` (funciones puras + degradación sin clave): 5/5 OK.

## Fase 3 — Indexado al generar

- [x] 3.1 `analizar.ts` → `analizarEnvio` rama Vercel: tras publicar el informe en Storage, llamar
      `indexarInforme` (dynamic import de `rag.mjs`, try/catch + log).
- [x] 3.2 `analizar.ts` → `analizarEnvio` rama local: idem, leyendo el HTML publicado en
      `public/informes` desde la entrada del manifest (token de `data.token`).
- [x] 3.3 Verificar: generar un informe sin clave MaaS → generación OK + log de omisión
      (smoke test del CLI `--lote --lote-sin-pdf --sin-ia`: informe idéntico, sin sección RAG).

## Fase 4 — Contexto en el análisis

- [x] 4.1 `analizar.ts` → `analizarEnvio` rama Vercel: pasar `token` a `analizarEnvioLote`;
      `lote.mjs` recupera contexto y lo propaga.
- [x] 4.2 `analizar.ts` → `analizarEnvio` rama local: pasar `SUPABASE_TOKEN` en el env del spawn;
      `cli.mjs --lote` recupera contexto y lo propaga.
- [x] 4.3 `gemini.mjs` (antes `openai.mjs`): sección "CONTEXTO DE REFERENCIA" en `INSTRUCCION_SISTEMA_RESUMEN` (regla:
      referencia, no evidencia; no inventar citas sobre él); bump `VERSION_PROMPT`
      (`2026-11-11.1-rag-contexto`).
- [x] 4.4 `informe.mjs`: sección "Contexto consultado" en `construirHtmlLote`/`generarInformeLote`
      cuando hay contexto.
- [x] 4.5 Verificar: informe generado sin base → idéntico a hoy (smoke test OK); con base →
      sección presente (pendiente de la clave MaaS).

## Fase 5 — Búsqueda en la UI

- [x] 5.1 `src/lib/base-conocimiento.ts`: server fns `buscarConocimiento` y `estadoConocimiento`
      (token del usuario; nada de lógica en el cliente).
- [x] 5.2 `src/routes/admin.base-conocimiento.tsx`: buscador, resultados (fuente, colaborador,
      fecha, extracto, similitud), estados: sin configurar / índice vacío / vacío / error / carga.
- [x] 5.3 `src/lib/nav.ts`: entrada "Base de conocimiento" (roles jefatura + administracion;
      se añadió jefatura al grupo Administración para que la vea).
- [ ] 5.4 Verificar estados manualmente en local (requiere `npm run dev` + sesión).

## Fase 6 — Backfill y deploy

- [x] 6.1 `rag-backfill.mjs`: indexar informes existentes (manifest local; token por env;
      idempotente por fuente).
- [ ] 6.2 Deploy a Vercel; `vercel env add` de `MAAS_*` cuando lleguen las credenciales.
- [ ] 6.3 Prueba end-to-end en producción (flujo completo de la sección Verificación del plan).

## Notes

- 2026-11-11: el trigger de indexado pasó de "al aprobar" a "al generar" (decisión del usuario): el
  botón "Aprobar informe" del editor desapareció de la UI en una iteración paralela y `aprobarInforme`
  ya no se llama desde ninguna parte, así que "al aprobar" no era alcanzable.
- 2026-11-11: el índice pasó de la tabla `horas.rag_chunks` (pgvector) a **Storage** (archivos
  `rag-<informe>.rag` en `informes-ia/`): no hay acceso para modificar la base de datos de Supabase.
  La similitud se calcula en JS; el SQL queda como migración futura. De paso se corrigió un bug latente
  en `base-conocimiento.ts` (`maasConfigurado` se tomaba de rag.mjs, que no lo re-exporta).
- 2026-11-11: sin credenciales del MaaS todavía, se añadió `MAAS_PROVEEDOR` (tarea 1.4): `openai`
  para pruebas con la clave ya existente, `maas` (default) para producción — al desplegar a Vercel
  basta con definir `MAAS_API_KEY`/`MAAS_BASE_URL`, sin cambios de código.
- 2026-11-11: la clave OpenAI expiró (401) → **migración a Gemini** (decisión del usuario): el
  análisis pasa a `gemini-3.1-flash-lite` (API nativa generateContent, `gemini.mjs` reemplaza a
  `openai.mjs`) y el proveedor de pruebas del RAG pasa de `openai` a `gemini` (tarea 1.4;
  `gemini-embedding-001` a 1024 dims, task types RETRIEVAL_*). `VERSION_PROMPT` 2026-11-11.2-gemini.
