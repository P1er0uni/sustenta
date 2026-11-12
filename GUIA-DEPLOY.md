# Guía de despliegue — Sustenta en Vercel

Esta guía te lleva paso a paso desde cero hasta tener Sustenta corriendo en
Vercel, leyendo tus propias reuniones de Outlook/Teams con tu propio correo
de Microsoft.

---

## Qué necesitas antes de empezar

1. **Node.js 20+** y **npm** instalados (`node --version` debe funcionar).
2. Una cuenta en **Vercel** (gratis, entra en [vercel.com](https://vercel.com)).
3. Una cuenta de **Microsoft 365** con calendario (Outlook/Teams) — la que
   quieres usar para ver tus reuniones reales.
4. Acceso al **Azure Portal** / **Microsoft Entra ID** para registrar la app.
   Si tu cuenta Microsoft 365 no te deja entrar a Entra ID, pide a un admin
   que te dé el rol de **Application Developer** o que haga el registro por ti.

---

## Paso 1 — Descomprimir e instalar

```sh
unzip sustenta-deploy.zip -d sustenta
cd sustenta
npm install
```

Verifica que compila en local:

```sh
npm run dev
```

Abre `http://localhost:5173`. Deberías ver la pantalla de carga y luego el
login. Cierra el dev server con `Ctrl+C` — ahora vamos a producción.

---

## Paso 2 — Registrar la app en Microsoft Entra ID

1. Entra a [entra.microsoft.com](https://entra.microsoft.com) con tu cuenta
   Microsoft 365.
2. Ve a **Identity → Applications → App registrations → New registration**.
3. **Nombre:** `Sustenta`
4. **Supported account types:** selecciona
   *"Accounts in any organizational directory and personal Microsoft accounts"*.
   Esto permite que cualquier cuenta de Microsoft pueda conectarse.
5. **Redirect URI:** selecciona plataforma **Single-page application (SPA)**
   y pon por ahora `http://localhost:5173`. Luego agregaremos la URL de Vercel.
6. Clic en **Register**.

Anota dos valores de la página **Overview**:

- **Application (client) ID** — lo vas a necesitar en el Paso 4.
- (El **Tenant ID** no lo necesitas si elegiste "any organizational directory"
  — se usa `common` automáticamente.)

---

## Paso 3 — Agregar el permiso de calendario

1. En el menú izquierdo de tu app registration, ve a **API permissions**.
2. Clic en **Add a permission → Microsoft Graph → Delegated permissions**.
3. Busca y marca **`Calendars.Read`**.
4. Clic en **Add permissions**.
5. Si tu tenant lo exige, verás un botón **"Grant admin consent for [tenant]"**.
   Pídele a un admin que lo clickee. Si no aparece, no te preocupes — el
   consentimiento lo dará cada usuario la primera vez que conecte.

---

## Paso 4 — Crear el archivo `.env`

En la raíz del proyecto, crea un archivo llamado `.env` (exactamente así, con
el punto) con este contenido:

```
VITE_MS_CLIENT_ID=<pega-aquí-el-Application-client-ID-del-Paso-2>
VITE_MS_TENANT_ID=common
```

Ejemplo:

```
VITE_MS_CLIENT_ID=82d731bb-3aa6-4abe-bb43-c1db909090dd
VITE_MS_TENANT_ID=common
```

> **Nota:** El archivo `.env` ya está en `.gitignore`, así que no se sube a
> git. Las variables `VITE_*` se incrustan al momento de compilar (build time),
> no en tiempo de ejecución. Por eso hay que configurarlas también en Vercel
> (Paso 7).

---

## Paso 5 — Desplegar en Vercel

Desde la terminal, dentro de la carpeta del proyecto:

```sh
# Login (abre el navegador para autorizar)
npx vercel login

# Desplegar a producción
npx vercel deploy --prod --yes
```

La primera vez, Vercel te hará algunas preguntas:

- **Set up and deploy?** → `Y`
- **Which scope?** → tu cuenta
- **Link to existing project?** → `N` (es nuevo)
- **Project name?** → `sustenta` (o el nombre que quieras)
- **Directory?** → `./`
- **Modify settings?** → `N` (el `vercel.json` ya tiene la config)

Al terminar, Vercel te da una URL como:
```
https://sustenta-xxxxx.vercel.app
```

**Anota esa URL** — la necesitas en el Paso 6.

---

## Paso 6 — Agregar la URL de Vercel como Redirect URI en Azure

1. Vuelve a [entra.microsoft.com](https://entra.microsoft.com) → tu app
   registration `Sustenta` → **Authentication**.
2. En la sección **Single-page application**, clic en **Add URI**.
3. Pega la URL de Vercel **sin barra final**:
   ```
   https://sustenta-xxxxx.vercel.app
   ```
4. Clic en **Save**.

> **Importante:** La URL debe ser exacta, sin `/` al final y sin path.
> Si tu URL de Vercel tiene un dominio personalizado, usa ese.

---

## Paso 7 — Configurar las variables de entorno en Vercel

Las variables del `.env` local no se suben a Vercel. Hay que configurarlas
en el dashboard:

```sh
# Agregar las variables (te pedirá el valor y el entorno)
npx vercel env add VITE_MS_CLIENT_ID production
npx vercel env add VITE_MS_TENANT_ID production
```

### Variables del agente IA (análisis de sustentos + RAG)

El agente (`agente-sustentos/`) usa dos proveedores de IA, cada uno con su
variable. En local la config se lee de `agente-sustentos/.env` (no está en el
repo); en Vercel va como variables de entorno del proyecto (`process.env`
tiene prioridad sobre el archivo).

**Informes — `IA_PROVEEDOR`** (quién genera veredictos y resúmenes):

```sh
# Producción — MaaS de Huawei (ModelArts Studio):
npx vercel env add IA_PROVEEDOR production          # "maas" (default)
npx vercel env add MAAS_API_KEY production
npx vercel env add MAAS_BASE_URL production         # el access point del despliegue
npx vercel env add MAAS_ANALISIS_MODEL production    # el modelo de chat desplegado
# O pruebas — Gemini:
#   IA_PROVEEDOR=gemini + GEMINI_API_KEY (y opcional GEMINI_MODEL)
```

**Embeddings del RAG — `MAAS_PROVEEDOR`** (hoy `gemini`: el MaaS de Huawei
CN-Hong Kong es solo de chat, sin embeddings):

```sh
npx vercel env add MAAS_PROVEEDOR production   # "gemini"
npx vercel env add GEMINI_API_KEY production
# Opcional — modelo de embeddings (default gemini-embedding-001 a 1024 dims):
npx vercel env add MAAS_EMBEDDING_MODEL production
```

Sin credenciales del proveedor del análisis, la IA falla en producción (las
reglas locales sí corren) y el RAG se omite. La conexión a Supabase no
requiere configuración: la URL y la clave anon (pública por diseño) van en el
código (`src/integrations/sustenta/client.ts`).

O desde el navegador:

1. Entra a [vercel.com/dashboard](https://vercel.com/dashboard) → tu proyecto
   `sustenta` → **Settings → Environment Variables**.
2. Agrega:
   - `VITE_MS_CLIENT_ID` = el mismo valor del `.env` (Production)
   - `VITE_MS_TENANT_ID` = `common` (Production)

---

## Paso 8 — Redesplegar con las variables de entorno

Como las variables `VITE_*` se incrustan al compilar, necesitas redesplegar
para que Vercel las tome:

```sh
npx vercel deploy --prod --yes
```

Esta vez el build ya tendrá las variables y la app quedará completa.

---

## Paso 9 — Usar la app con tu correo

1. Abre la URL de Vercel en el navegador:
   ```
   https://sustenta-xxxxx.vercel.app
   ```
2. Inicia sesión con tu cuenta de Supabase (las credenciales que te dé el
   administrador del proyecto).
3. Ve a **Horas → Mi agenda** en el menú lateral.
4. Clic en **"Conectar Outlook"**.
5. Se abre una ventana emergente de Microsoft — inicia sesión con **tu propio
   correo** de Microsoft 365.
6. Acepta el permiso "Leer tu calendario" (Calendars.Read).
7. La ventana se cierra y verás tus **reuniones reales** del mes en la agenda.

> Si el navegador bloquea el popup, permite popups para ese sitio y vuelve
> a clickear "Conectar Outlook".

---

## Resumen de qué hace cada pieza

| Componente | Para qué sirve |
|---|---|
| **Azure App Registration** | Identifica la app ante Microsoft; define qué permisos pide y a qué URLs puede redirigir |
| **`VITE_MS_CLIENT_ID`** | El ID de esa app registration; se incrusta en el build |
| **`VITE_MS_TENANT_ID=common`** | Permite login con cualquier cuenta de Microsoft (organizacional o personal) |
| **Redirect URI (SPA)** | Le dice a Microsoft que confíe en esa URL para recibir el token de vuelta |
| **`Calendars.Read`** | Permiso delegado de solo lectura del calendario del usuario |
| **MSAL.js (PKCE)** | Librería que maneja el flujo OAuth sin client secret (es una SPA, cliente público) |

---

## Si algo falla

### "AADSTS50011: Redirect URI mismatch"
La URL en Azure no coincide con la URL de la app. Verifica que en
**Authentication → SPA** esté exactamente `https://tu-url.vercel.app`
sin barra final.

### El botón "Conectar Outlook" no aparece
`VITE_MS_CLIENT_ID` está vacío en el build. Verifica que la variable esté
configurada en Vercel (Settings → Environment Variables) y vuelve a
desplegar.

### Popup bloqueado
Permite popups para la URL de Vercel en tu navegador y reintenta.

### Error de Supabase al iniciar sesión
El proyecto usa un Supabase compartido. Pide al administrador que cree tu
usuario en Supabase o que te dé credenciales de prueba.

---

## Contacto

Si tienes dudas, el código fuente y esta guía vienen dentro del zip.
La integración de Microsoft está en `src/integrations/microsoft/` y el
contexto React en `src/context/microsoft.tsx`.
