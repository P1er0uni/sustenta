# Agente de revisión de sustentos: guía de uso

## Qué hace

Lee cada archivo de sustento de un registro de horas, lo contrasta con la fecha, el colaborador, el proyecto y la actividad registrados, y emite un veredicto (sustenta, sustenta parcialmente, no sustenta o ilegible). El veredicto va con citas textuales del documento y se entrega en un informe PDF.

Es **consultivo**: no aprueba, no rechaza y no modifica nada en Sustenta.

## Qué necesitas

- **Windows**, con **Node.js 20 o superior** (`node --version` debe responder).
- **Microsoft Edge o Google Chrome**, para generar el PDF. Sin ellos el agente deja el informe en HTML.
- Una **clave de API de OpenAI** para el análisis (paso 3) — platform.openai.com → API keys.
- Internet, salvo que uses el modo sin IA.

## 1. Descomprimir

Extrae el zip en cualquier carpeta, por ejemplo `C:\Users\TuUsuario\Documents\agente-sustentos`. En la carpeta deben verse `src`, `test`, `casos`, `package.json` y similares.

## 2. Instalar

Abre PowerShell dentro de esa carpeta. Con el Explorador, clic derecho dentro de la carpeta y "Abrir en Terminal". Luego ejecuta:

```powershell
npm install
```

Se hace una sola vez.

## 3. Configurar la IA (OpenAI para informes, Gemini para el RAG)

El agente usa dos proveedores de IA, cada uno con su variable del `.env`:

| Qué | Variable | Valores |
|---|---|---|
| **Genera los informes** (veredictos y resúmenes) | `OPENAI_API_KEY` | Clave de platform.openai.com (modelo default `gpt-5.6`) |
| **Embeddings del RAG** (base de conocimiento) | `GEMINI_API_KEY` | Clave de aistudio.google.com (modelo default `gemini-embedding-001`) |

Están separados a propósito: los informes los genera OpenAI y el RAG corre con Gemini.

### OpenAI (informes)

1. Entra a https://platform.openai.com → **API keys** y crea una clave.
2. En la carpeta del agente abre el archivo `.env` (si no existe, créalo con ese nombre exacto,
   sin `.txt`) y pega:

   ```
   OPENAI_API_KEY=tu_clave_aqui
   ```

3. Guarda. No compartas ese archivo ni lo subas a ningún repositorio.

**Sobre el modelo.** Se usa `gpt-5.6` por defecto. Puedes cambiarlo en el `.env`
(`OPENAI_MODEL=...`) o al correr el comando (`--modelo <id>`).

Cómo entra la evidencia al modelo:

- **XLSX / DOCX / PPTX**: el texto ya extraído (igual que siempre).
- **PDF e imágenes (PNG/JPG)**: van en línea como archivo/imagen en base64 — GPT los lee
  nativamente. Si un PDF es escaneado y el modelo no puede leerlo, el veredicto sale ilegible.

### Gemini (embeddings del RAG)

El RAG (spec `specs/002-rag-base-conocimiento/` de la plataforma) convierte los informes generados en
una base de conocimiento buscable por significado. Los **embeddings** los calcula Gemini con la
`GEMINI_API_KEY`. Variables del `.env`:

- `GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_DIMS`: default `gemini-embedding-001`/1024 (la
  dimensionalidad del índice ya existente en Storage). `GEMINI_EMBEDDING_DIMS` es informativa: el
  índice del RAG vive en Storage (archivos `.rag` junto a los informes IA), no hay que crear nada
  en Supabase.
- **Sin `GEMINI_API_KEY`, el agente y la plataforma funcionan igual**: el RAG simplemente se omite
  (indexado, contexto del resumen y búsqueda quedan desactivados y se loguea).
- Backfill de informes ya generados: `SUPABASE_TOKEN=<token_de_sesion> node src/rag-backfill.mjs`.

## 4. Correr el agente

Desde la carpeta del agente:

```powershell
npm run analizar -- casos/juan-pablo-2026-09-02.json casos/juan-pablo-2026-09-09.json
```

Debes estar dentro de la carpeta, y el `--` antes de los archivos es obligatorio.

Los dos casos incluidos son una demo: dos días de un colaborador que adjuntó como evidencia una liquidación de agosto para trabajo de setiembre.

## 5. Qué obtienes

- **En la terminal:** veredicto, comprobaciones, citas y alertas de cada registro.
- **Un PDF por registro** en la carpeta `informes\`.
- **Un JSON** con el análisis completo en `resultados\`.

## 6. Cómo leer el veredicto

| Veredicto | Significa |
|---|---|
| **sustenta** | El documento respalda fecha, actividad y proyecto, y la magnitud de horas |
| **sustenta parcialmente** | Respalda algunos elementos; otros faltan o son ambiguos |
| **no sustenta** | No corresponde: otra fecha, otra persona o proyecto, otro tema, o no es evidencia |
| **ilegible** | No se pudo leer lo suficiente |

- **"Confianza"** indica qué tan seguro está el agente *de su veredicto*, no qué tan bien sustenta el documento. "No sustenta, confianza alta" significa que está seguro de que no sustenta.
- Las citas se verifican contra el texto del documento. Si una cita no aparece literalmente, se descarta.
- Las "reglas deterministas" son comprobaciones fijas, sin IA: hash alterado, archivo duplicado, periodo distinto, proyecto ausente y documento generado por la propia plataforma.
- Los criterios son una propuesta de trabajo. **Deben ser validados por el equipo tributario** antes de usarse como política.

## 7. Analizar tus propios registros

1. Copia tus archivos de sustento a la carpeta `casos\`. Se aceptan PDF, PNG, JPG, JPEG, DOCX, XLSX y PPTX.
2. Copia uno de los `.json` de `casos\` y cámbiale el nombre y los datos:

```json
{
  "registro": {
    "id": "reg-2026-09-15",
    "fecha": "2026-09-15",
    "horas": 4,
    "colaborador": "Nombre Apellido",
    "actividad": "Análisis de estados financieros",
    "descripcion": "Lo que escribió el colaborador",
    "empresaReceptora": "AC Inmobiliaria S.A.C.",
    "cobrable": false,
    "proyecto": {
      "codigo": "90001",
      "nombre": "Reporte Contable - Inmobiliaria",
      "descripcion": "Descripción del servicio",
      "inicio": "2026-09-01",
      "fin": "2026-09-30"
    }
  },
  "archivos": ["mi-sustento.pdf"]
}
```

3. El `id` debe ser único, porque da nombre al PDF. Los archivos de `archivos` se buscan junto al `.json`. Si un registro tiene varios archivos, pon todos en la lista.
4. Ejecuta el comando del paso 4 con tu archivo. Si pasas varios casos a la vez, el agente detecta también la misma evidencia reutilizada entre ellos.

## 8. Opciones útiles

| Quiero... | Comando |
|---|---|
| Correr sin IA, sin clave ni internet (solo reglas) | añadir `--sin-ia` |
| No generar el PDF | añadir `--sin-pdf` |
| Usar otro modelo de OpenAI | añadir `--modelo <id>` |
| Rehacer los PDF sin gastar cuota | `npm run informe -- resultados\<archivo>.json casos\<caso>.json` |
| Verificar que el código funciona | `npm test` |

## 9. Problemas frecuentes

| Mensaje | Causa y solución |
|---|---|
| `Falta OPENAI_API_KEY` | El `.env` no existe, se llama `.env.txt` o la clave no está pegada |
| 429 / cuota agotada | Cuota de OpenAI agotada o sin crédito: revisa el saldo y método de pago en platform.openai.com (Billing), o prueba otro modelo con `--modelo <id>` |
| 401/403 / clave inválida | La clave está mal copiada, fue revocada o pertenece a otro proyecto/organización |
| 404 / modelo no disponible | El nombre del modelo no existe en OpenAI: usa `--modelo` con otro (o actualiza `OPENAI_MODEL` en el `.env`) |
| `Falta GEMINI_API_KEY` (RAG) | Los embeddings del RAG necesitan la clave de aistudio.google.com; sin ella el RAG se omite y el resto funciona igual |
| "Formato no aceptado" | El archivo no es de los formatos soportados |
| Se creó un HTML en vez de un PDF | No hay Edge ni Chrome instalados: abre el HTML y usa Ctrl+P → Guardar como PDF |

## Privacidad

Con el modo con IA, los documentos se envían a la API de OpenAI para su lectura (y al RAG, a la de
Gemini). Úsalo con datos de demostración hasta confirmar con el área correspondiente que los
documentos reales pueden salir hacia ese servicio.
