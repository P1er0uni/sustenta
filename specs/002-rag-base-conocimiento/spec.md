# Spec 002 — RAG: base de conocimiento de informes aprobados

## WHY

Hoy el análisis IA de un envío es **sin memoria**: `analizarEnvio` → `lote.mjs` → el LLM de análisis ve únicamente la
evidencia del envío actual. La jefatura no puede preguntarle a la IA "¿este colaborador es consistente con
sus envíos anteriores?" ni buscar precedentes entre informes ya aprobados. Cada informe aprobado es
conocimiento que hoy se archiva (Storage) y se olvida.

Un RAG (Retrieval-Augmented Generation) resuelve esto en dos tiempos:

1. **Indexar**: al aprobar un informe, su texto se trocea, se convierte en vectores (embeddings) con un
   **MaaS de Huawei** y se guarda como índice en el Storage de Supabase (junto a los informes).
2. **Consultar**: al analizar un envío nuevo, se recuperan los fragmentos más parecidos por significado y
   se inyectan al prompt del resumen ejecutivo; además una página permite **búsqueda semántica** sobre
   esa base ("reuniones de coordinación en octubre" encuentra fragmentos aunque no coincidan las
   palabras exactas).

Para la demo esto muestra el flujo completo de un RAG real: indexado automático → recuperación →
generación aumentada → búsqueda visible, sin claves nuevas salvo las del MaaS.

**Decisión del usuario (2026-11-11):** fuente = solo informes aprobados; embeddings = MaaS de Huawei
(otro proveedor distinto al LLM de análisis, hoy Gemini — migrado de OpenAI el 2026-11-11); sí a la
mini página de búsqueda.
Todo debe quedar preparado para que al poner la API key del MaaS ya funcione, sin cambios de código.

**Ajuste durante el plan (2026-11-11):** el server fn `aprobarInforme` ya no se llama desde la UI
(el editor `informe.editar.tsx` quedó como solo-visor), así que "al aprobar" no tiene trigger
alcanzable. Decisión del usuario: **indexar al generar** (cuando `analizarEnvio` publica el informe).
La base contiene entonces informes generados (no necesariamente aprobados por la jefatura).

**Ajuste durante la implementación (2026-11-11):** no hay acceso para modificar la base de datos de
Supabase (crear tablas), así que el índice pasó de la tabla `horas.rag_chunks` (pgvector) a
**Storage**: un archivo `rag-<informe>.rag` por informe en la misma carpeta `informes-ia/` del bucket
`sustentos`, con los fragmentos y sus embeddings. La similitud se calcula en JS al buscar. Hereda
las políticas RLS que ya funcionan para los informes — cero SQL. El script pgvector de la spec
queda como **migración futura** si hace falta escalar a cientos de informes.

## WHAT

### Historias de usuario

1. **Indexar.** Como jefatura, cuando genero el informe IA de un envío quiero que su texto quede
   automáticamente en la base de conocimiento, para acumular memoria de sustentos sin trabajo extra.
2. **Consultar.** Como jefatura, cuando genero el informe IA de un nuevo envío quiero que el resumen
   ejecutivo considere los informes aprobados previos del colaborador, para que note consistencia o
   recurrencia en lugar de analizar cada envío en el vacío.
3. **Buscar.** Como usuario administrativo/jefatura, quiero buscar por significado en los informes
   aprobados, para encontrar precedentes sin conocer fechas o nombres exactos.
4. **Activar.** Como administrador de la demo, quiero que todo el pipeline quede listo y se active solo
   con configurar las credenciales del MaaS de Huawei (variables de entorno), sin tocar código.

### Requisitos funcionales (EARS)

- **WHEN** se genera el informe consolidado de un envío (`analizarEnvio`, ramas Vercel y local) **THEN**
  el sistema sube un archivo de índice `rag-<informe>.rag` a Storage (misma carpeta que los informes)
  con los fragmentos del HTML, sus embeddings y su metadata (fuente, colaborador, fecha, tipo).
- **IF** la indexación falla (MaaS sin configurar, sin token, error de red) **THEN** la generación se
  completa igualmente y el fallo queda registrado solo en el log del servidor.
- **WHEN** se genera el informe de un envío y la base de conocimiento tiene fragmentos relevantes
  **THEN** el prompt del resumen ejecutivo los incluye como contexto de referencia y el informe HTML
  muestra la sección "Contexto consultado" (fuente y extracto de cada fragmento).
- **IF** no hay base de conocimiento (o la recuperación falla) **THEN** el análisis y el informe se
  generan exactamente como hoy, sin contexto y sin error visible para el usuario.
- **WHEN** un usuario autenticado busca en la página "Base de conocimiento" **THEN** el sistema incrusta
  la consulta con el MaaS, baja el índice de Storage, puntúa los fragmentos con similitud coseno y
  muestra los más parecidos con fuente, colaborador, fecha y extracto.
- **IF** el MaaS no está configurado **THEN** la página de búsqueda muestra un aviso claro de
  configuración (no un error crudo).
- **WHERE** Supabase **THEN** RLS del bucket `sustentos` (el índice vive en la misma carpeta
  `informes-ia/` que los informes): solo usuarios autenticados leen/escriben; las server fns actúan
  con el access_token del usuario logueado (mismo patrón que los informes IA).
- **WHILE** el MaaS no tenga credenciales **THEN** todas las features de la app funcionan igual que hoy
  (degradación elegante: el RAG nunca bloquea aprobaciones, análisis ni navegación).

### Requisitos no funcionales

- **Proveedor de embeddings:** MaaS de Huawei. Supuesto de diseño (a confirmar al llegar las
  credenciales): endpoint compatible con la API de embeddings de OpenAI (`POST {base}/embeddings` con
  `{model, input}` → `{data: [{embedding}]}`), que es lo habitual en ModelArts Studio. Toda la
  integración vive en un único módulo adaptador (`maas.mjs`): si el formato real difiere, se cambia solo
  su interior. **Para PRUEBAS mientras llegan las credenciales** (decisión del usuario, 2026-11-11):
  `MAAS_PROVEEDOR=gemini` activa el mismo adaptador con la GEMINI_API_KEY (`gemini-embedding-001`,
  1024 dims — las mismas que bge-m3); en producción vuelve a `maas` (default) con las credenciales
  del MaaS. El índice se etiqueta por proveedor (`rag-*.maas.rag` / `rag-*.gemini.rag`) para que el
  cambio no choque con el índice de pruebas.
- **Configuración:** `MAAS_PROVEEDOR`, `MAAS_API_KEY`, `MAAS_BASE_URL`, `MAAS_EMBEDDING_MODEL`,
  `MAAS_EMBEDDING_DIMS` como variables de entorno (local: `agente-sustentos/.env`; Vercel: env vars
  del proyecto). Sanitizar BOM (ya pasó con `OPENAI_API_KEY`).
- **Costo/latencia:** 1 llamada de embeddings por aprobación (los chunks del informe en batch), 1 por
  análisis de envío y 1 por búsqueda. Dimensionamiento esperado: despreciable frente a las llamadas al
  LLM de análisis.
- **Trazabilidad:** el informe consolidado muestra qué fragmentos se consultaron (fuente + extracto),
  en la misma línea que las citas verificadas actuales.
- **Sin dependencias nuevas** en la app (el SDK `openai` ya está; el acceso a Supabase es REST plano con
  el token del usuario).

### Fuera de alcance

- Indexar normativa/documentos que el usuario suba (posible fase futura; la fuente v1 es solo informes
  aprobados).
- Cambiar el LLM de análisis (la migración OpenAI→Gemini del 2026-11-11 se hizo fuera de esta spec);
  dentro de la spec, solo los **embeddings** van al MaaS de Huawei.
- Pasar contexto RAG al análisis **por registro** (v1 lo usa solo en el resumen ejecutivo del envío).
- Re-indexado automático de informes históricos: se entrega un **script manual de backfill**
  (`rag-backfill.mjs`), no un proceso automático.
- Respuestas redactadas por IA sobre la base (la búsqueda devuelve fragmentos, no un chat), reranking,
  búsqueda híbrida léxica+semántica, filtros por colaborador en la UI.
- Modo demo: no se exige precisión de recuperación; sí que el flujo completo sea visible y trazable.
