# Agente de revisión de sustentos: guía de uso

## Qué hace

Lee cada archivo de sustento de un registro de horas, lo contrasta con la fecha, el colaborador, el proyecto y la actividad registrados, y emite un veredicto (sustenta, sustenta parcialmente, no sustenta o ilegible). El veredicto va con citas textuales del documento y se entrega en un informe PDF.

Es **consultivo**: no aprueba, no rechaza y no modifica nada en Sustenta.

## Qué necesitas

- **Windows**, con **Node.js 20 o superior** (`node --version` debe responder).
- **Microsoft Edge o Google Chrome**, para generar el PDF. Sin ellos el agente deja el informe en HTML.
- Una **clave de API de OpenAI** propia (paso 3). Ojo: no basta con una suscripción de ChatGPT; la clave se crea en platform.openai.com y la API se paga por uso.
- Internet, salvo que uses el modo sin IA.

## 1. Descomprimir

Extrae el zip en cualquier carpeta, por ejemplo `C:\Users\TuUsuario\Documents\agente-sustentos`. En la carpeta deben verse `src`, `test`, `casos`, `package.json` y similares.

## 2. Instalar

Abre PowerShell dentro de esa carpeta. Con el Explorador, clic derecho dentro de la carpeta y "Abrir en Terminal". Luego ejecuta:

```powershell
npm install
```

Se hace una sola vez.

## 3. Configurar la clave de OpenAI

1. Entra a https://platform.openai.com, inicia sesión y ve a **API keys** para crear una clave.
2. En **Billing** carga un método de pago: la API de OpenAI no tiene plan gratuito y cada análisis consume crédito (los análisis típicos de este agente cuestan centavos).
3. En la carpeta del agente abre el archivo `.env` (si no existe, créalo con ese nombre exacto, sin `.txt`) y pega tu clave en la primera línea:

   ```
   OPENAI_API_KEY=sk-tu_clave_aqui
   ```

4. Guarda. No compartas ese archivo ni lo subas a ningún repositorio.

**Sobre el modelo.** Por defecto se usa `gpt-5.6`. Puedes cambiarlo en el `.env` (`OPENAI_MODEL=...`) o al correr el comando (`--modelo <id>`).

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
| Usar otro modelo de OpenAI | añadir `--modelo gpt-5.6` (o el que quieras) |
| Rehacer los PDF sin gastar cuota | `npm run informe -- resultados\<archivo>.json casos\<caso>.json` |
| Verificar que el código funciona | `npm test` |

## 9. Problemas frecuentes

| Mensaje | Causa y solución |
|---|---|
| `Falta OPENAI_API_KEY` | El `.env` no existe, está en otra carpeta, se llama `.env.txt` o la clave no está pegada |
| 429 / cuota agotada | La cuenta no tiene crédito o superó su límite: revisa Billing en platform.openai.com |
| 401 / clave inválida | La clave está mal copiada, fue revocada o pertenece a otro proyecto |
| 404 / modelo no disponible | El nombre del modelo no existe: usa `--modelo` con otro (o actualiza `OPENAI_MODEL` en el `.env`) |
| "Formato no aceptado" | El archivo no es de los formatos soportados |
| Se creó un HTML en vez de un PDF | No hay Edge ni Chrome instalados: abre el HTML y usa Ctrl+P → Guardar como PDF |

## Privacidad

Con el modo con IA, los documentos se envían a la API de OpenAI para su lectura. Úsalo con datos de demostración hasta confirmar con el área correspondiente que los documentos reales pueden salir hacia ese servicio.
