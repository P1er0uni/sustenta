# Agente de revisión de sustentos: guía de uso

## Qué hace

Lee cada archivo de sustento de un registro de horas, lo contrasta con la fecha, el colaborador, el proyecto y la actividad registrados, y emite un veredicto (sustenta, sustenta parcialmente, no sustenta o ilegible). El veredicto va con citas textuales del documento y se entrega en un informe PDF.

Es **consultivo**: no aprueba, no rechaza y no modifica nada en Sustenta.

## Qué necesitas

- **Windows**, con **Node.js 20 o superior** (`node --version` debe responder).
- **Microsoft Edge o Google Chrome**, para generar el PDF. Sin ellos el agente deja el informe en HTML.
- Una IA para el análisis, una de estas dos (paso 3):
  - **MaaS de Huawei (ModelArts Studio)** — el proveedor de producción: con sus credenciales, los informes los generan sus modelos de chat.
  - **Una clave de API de Gemini** — para pruebas: se crea gratis en aistudio.google.com y la capa gratuita alcanza (con límites por minuto/día).
- Internet, salvo que uses el modo sin IA.

## 1. Descomprimir

Extrae el zip en cualquier carpeta, por ejemplo `C:\Users\TuUsuario\Documents\agente-sustentos`. En la carpeta deben verse `src`, `test`, `casos`, `package.json` y similares.

## 2. Instalar

Abre PowerShell dentro de esa carpeta. Con el Explorador, clic derecho dentro de la carpeta y "Abrir en Terminal". Luego ejecuta:

```powershell
npm install
```

Se hace una sola vez.

## 3. Configurar la IA (MaaS de Huawei o Gemini)

El agente usa dos proveedores de IA, cada uno con su variable del `.env`:

| Qué | Variable | Valores |
|---|---|---|
| **Genera los informes** (veredictos y resúmenes) | `IA_PROVEEDOR` | `maas` (default, producción) · `gemini` (pruebas) |
| **Embeddings del RAG** (base de conocimiento) | `MAAS_PROVEEDOR` | `gemini` (hoy el único que funciona) · `maas` (si tu despliegue los expone) |

Están separados a propósito: el MaaS de Huawei (CN-Hong Kong) hoy es **solo de chat** — no expone
embeddings — así que los informes los genera el MaaS y el RAG sigue corriendo con Gemini.

### Opción A — MaaS de Huawei (producción, informes)

Cuando tengas las credenciales de tu despliegue MaaS, en el `.env` (si no existe, créalo con ese
nombre exacto, sin `.txt`):

```
IA_PROVEEDOR=maas
MAAS_API_KEY=tu_api_key_del_maas
MAAS_BASE_URL=https://api-ap-southeast-1.modelarts-maas.com/openai/v1
MAAS_ANALISIS_MODEL=glm-5.3
```

- `MAAS_BASE_URL` es el **access point** de tu despliegue MaaS (el de arriba es el de la región
  CN-Hong Kong, la única con API compatible con OpenAI).
- `MAAS_ANALISIS_MODEL` es el modelo **primario** de la **cadena de redundancia** (opcional: si se
  quita, el primario es `glm-5.3`). Se puede sobreescribir por corrida con `--modelo <id>`.

**Redundancia de modelos.** El análisis usa la cadena `glm-5.3 → glm-5.2 → deepseek-v4.1-flash`:
cada modelo se intenta **2 veces** y, si no está disponible (cuota agotada, servicio caído, modelo
inexistente), se cae al siguiente dejando un aviso — "Cambio de modelo: …" en la terminal y una
notificación en la plataforma. Solo los errores de *disponibilidad* cambian de modelo; los de
contenido (400/422) se degradan el contenido y los de credenciales (401/403) no los arregla ningún
modelo. `MAAS_MODELOS` sobreescribe la cadena completa, separada por comas:

```
MAAS_MODELOS=glm-5.3,glm-5.2,deepseek-v4.1-flash
```

Cómo entra la evidencia al modelo de chat (la API de chat no lee binarios en línea como Gemini):

- **XLSX / DOCX / PPTX**: el texto ya extraído (igual que siempre).
- **PDF**: se le extrae el texto en el agente (unpdf). Si es escaneado y no hay texto, el modelo lo
  trata como ilegible.
- **Imágenes (PNG/JPG)**: van en base64 con el formato estándar de visión de la API de OpenAI, que
  los modelos multimodales del MaaS entienden (p. ej. DeepSeek-V4.1-Flash). Si tu modelo desplegado
  no admite imágenes, la llamada se degrada sola (la imagen se vuelve una nota) y el análisis sigue
  saliendo.

### Opción B — Gemini (pruebas, informes)

1. Entra a https://aistudio.google.com, inicia sesión con tu cuenta de Google y pulsa **"Get API key"** para crear una clave.
2. La capa **gratuita** alcanza para las pruebas del agente (con límites por minuto y por día). Para uso sostenido, activa billing en Google AI Studio.
3. En la carpeta del agente abre el archivo `.env` y pega:

   ```
   IA_PROVEEDOR=gemini
   GEMINI_API_KEY=tu_clave_aqui
   ```

4. Guarda. No compartas ese archivo ni lo subas a ningún repositorio.

**Sobre el modelo.** Con Gemini se usa `gemini-3.1-flash-lite` por defecto (el más barato de los
actuales, con capa gratuita; ver precios en aistudio.google.com/docs/pricing). Puedes cambiarlo en
el `.env` (`GEMINI_MODEL=...`) o al correr el comando (`--modelo <id>`).

### Embeddings del RAG (base de conocimiento)

El RAG (spec `specs/002-rag-base-conocimiento/` de la plataforma) convierte los informes generados en
una base de conocimiento buscable por significado. Los **embeddings** los calcula el proveedor de
`MAAS_PROVEEDOR` — hoy `gemini` (el MaaS de Huawei no expone embeddings). Variables del `.env`:

- `MAAS_EMBEDDING_MODEL` / `MAAS_EMBEDDING_DIMS`: default según proveedor (`bge-m3`/1024 con maas,
  `gemini-embedding-001`/1024 con gemini). `MAAS_EMBEDDING_DIMS` es informativa: el índice del RAG
  vive en Storage (archivos `.rag` junto a los informes IA), no hay que crear nada en Supabase.
- **Sin credenciales del proveedor activo, el agente y la plataforma funcionan igual**: el RAG
  simplemente se omite (indexado, contexto del resumen y búsqueda quedan desactivados y se loguea).
- Backfill de informes ya generados: `SUPABASE_TOKEN=<token_de_sesion> node src/rag-backfill.mjs`.
- **Si algún día cambias `MAAS_PROVEEDOR`** (p. ej. porque tu MaaS ya expone embeddings), corre el
  backfill otra vez: el índice se etiqueta por proveedor (`rag-*.maas.rag` / `rag-*.gemini.rag`) y
  la búsqueda usa solo el del proveedor activo.

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
| Usar otro modelo (del proveedor activo) | añadir `--modelo <id>` (con Gemini: `--modelo gemini-3.5-flash-lite`; con el MaaS: el nombre de otro modelo desplegado) |
| Rehacer los PDF sin gastar cuota | `npm run informe -- resultados\<archivo>.json casos\<caso>.json` |
| Verificar que el código funciona | `npm test` |

## 9. Problemas frecuentes

| Mensaje | Causa y solución |
|---|---|
| `Falta GEMINI_API_KEY` | El proveedor activo es Gemini (o el `.env` no existe, se llama `.env.txt` o la clave no está pegada) |
| `Falta configurar el MaaS de Huawei` / `MAAS_API_KEY` | El análisis usa el MaaS (`IA_PROVEEDOR=maas`): faltan `MAAS_API_KEY` y `MAAS_BASE_URL` en el `.env` |
| `Falta MAAS_ANALISIS_MODEL` | Ya no se exige: sin ella el primario es `glm-5.3` con la cadena de redundancia (arriba) |
| "Cambio de modelo: …" | No es un error: el modelo primario no estaba disponible y el informe salió con el siguiente de la cadena de redundancia (ver de qué modelo salió en la trazabilidad del informe) |
| 429 / cuota agotada | Límite de la capa gratuita de Gemini (por minuto o por día): espera un momento o revisa el uso en aistudio.google.com (Usage); con el MaaS, revisa la cuota de tu despliegue |
| 401/403 / clave inválida | La clave está mal copiada, fue revocada o pertenece a otro proyecto/despliegue |
| 404 / modelo no disponible | El nombre del modelo no existe en el proveedor activo: usa `--modelo` con otro (o actualiza `MAAS_ANALISIS_MODEL`/`GEMINI_MODEL` en el `.env`) |
| "Formato no aceptado" | El archivo no es de los formatos soportados |
| Se creó un HTML en vez de un PDF | No hay Edge ni Chrome instalados: abre el HTML y usa Ctrl+P → Guardar como PDF |

## Privacidad

Con el modo con IA, los documentos se envían a la API del proveedor activo para su lectura: el MaaS
de Huawei (ModelArts Studio) en producción, o Gemini (Google) en pruebas. Úsalo con datos de
demostración hasta confirmar con el área correspondiente que los documentos reales pueden salir
hacia ese servicio.
