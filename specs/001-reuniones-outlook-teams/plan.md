# Plan 001 — Reuniones de Outlook/Teams en Sustenta

Especificación: `spec.md` del mismo directorio. Este plan traduce los requisitos a
decisiones técnicas concretas sobre el código existente.

## Arquitectura

```
Navegador (SPA TanStack Start)
│
├─ MSAL.js (@azure/msal-browser)          ← login PKCE, caché y renovación de tokens
│    └─ access token (ámbito: Calendars.Read)
│
├─ Microsoft Graph                        ← GET /me/calendarview (rango del periodo)
│    └─ Reunion[] (solo en memoria, React Query)
│
└─ Supabase (intacto)                     ← hr_registro_hora, vistas hr_v_*
     └─ el registro creado desde una reunión es un registro común
```

Sin backend propio, sin cambios en Supabase, sin persistencia de reuniones.

## Módulo nuevo: `src/integrations/microsoft/`

### `client.ts` — instancia MSAL y estado de cuenta

- `MS_CLIENT_ID = import.meta.env["VITE_MS_CLIENT_ID"] ?? ""` y
  `MS_TENANT_ID = import.meta.env["VITE_MS_TENANT_ID"] ?? "common"` con el mismo
  patrón de defaults que usa `src/integrations/sustenta/client.ts`.
- `msConfigurado = MS_CLIENT_ID.length > 0` — si falta el client ID, la UI muestra
  un aviso de "integración no configurada" en lugar de romper.
- `PublicClientApplication` con:
  - `auth.clientId`, `auth.authority = https://login.microsoftonline.com/${tenant}`,
    `auth.redirectUri = window.location.origin` (MSAL exige URI exacta registrada
    en Azure; localhost:5173 en dev y el dominio público en producción).
  - `cache.cacheLocation = "sessionStorage"` y `temporales`: los tokens mueren al
    cerrar la pestaña — decisión deliberada para una demo de solo lectura.
- API del módulo: `conectarMicrosoft()` (loginPopup + `acquireTokenSilent` de
  `Calendars.Read`), `desconectarMicrosoft()` (logout + limpiar caché),
  `cuentaMicrosoftActiva()` y `obtenerTokenGraph()`.

### `graph.ts` — lectura del calendario

- `GET https://graph.microsoft.com/v1.0/me/calendarview` con:
  - `startDateTime` / `endDateTime` en ISO 8601 con offset Lima (`-05:00`).
  - `$select=subject,start,end,organizer,attendees,onlineMeeting,bodyPreview,isAllDay`.
  - header `Prefer: outlook.timezone="America/Lima"` → Graph devuelve las horas
    ya en hora local peruana; sin conversiones manuales de zona.
  - `$top=100` y paginado con `@odata.nextLink` (un mes rara vez lo supera, pero
    se contempla).
- Normaliza a `Reunion` (abajo) descartando eventos sin fecha de inicio.

### `types.ts` — tipo `Reunion`

```ts
export interface Reunion {
  id: string;                 // id de Graph (o sintético en demo)
  titulo: string;
  inicio: string;             // ISO local Lima, ej. 2026-10-29T15:00:00
  fin: string;
  dia: string;                // "2026-10-29" — clave para cruzar con el calendario
  organizador: string | null;
  asistentes: number;         // count, no la lista (privacidad mínima)
  enlaceTeams: string | null; // onlineMeeting.joinUrl
  todoElDia: boolean;
  previa: string | null;      // bodyPreview recortado
  origen: "microsoft" | "demo";
}
```

`dia` se calcula con `date-fns` (`format(parseISO(inicio), "yyyy-MM-dd")`) para que
el cruce con el calendario del registro sea un simple `r.dia === fecha`.

### `demo.ts` — modo demo

- `reunionesDemo(anio: number, mes: number): Reunion[]` — generador determinista
  (PRNG con semilla `anio*100+mes`) que siembra en días laborables del mes:
  - "Kickoff proyecto intragrupo" (lunes, 09:00, 1 h, con enlace Teams),
  - "Seguimiento semanal — AC Corporativo" (miércoles, 11:00, 1.5 h),
  - "Revisión de defense file" (jueves de la 2.ª semana, 16:00, 2 h),
  - "1:1 con jefatura" (viernes alternos, 10:00, 0.5 h),
  - "Capacitación tributaria" (1 vez al mes, 15:00, 1.5 h).
- Organizadores/asistentes con nombres genéricos del universo de la demo
  (Rosa, Óscar…). `origen: "demo"` y `id` sintético `demo-<semilla>-<n>`.
- Nunca se mezcla: si hay sesión de Microsoft activa, el modo demo queda
  deshabilitado y oculto.

## Estado y datos (React Query)

En `src/integrations/microsoft/hooks.ts`:

- `useCuentaMicrosoft()` — estado de la cuenta MSAL + `conectar` / `desconectar`
  como mutaciones que invalidan `["reuniones"]`.
- `useReuniones(rango: { inicio: string; fin: string } | null)` — query con clave
  `["reuniones", rango?.inicio, rango?.fin, origen]`:
  - sesión activa → `obtenerTokenGraph()` + `graph.ts`, `staleTime: 5 min`,
    `retry: 1` (un error de Graph no debe spamear).
  - sin sesión + modo demo activado → `reunionesDemo(anio, mes)`.
  - sin sesión + demo desactivado → `[]` (la UI muestra el CTA).
- El estado `modoDemo` vive en un pequeño contexto local (`MicrosoftProvider`)
  bajo `src/context/microsoft.tsx`, persistido en `sessionStorage` — coherente con
  la volatilidad elegida para los tokens.

## UI

### 1. Registro de horas (`src/routes/horas.registro.tsx`)

- **Calendario mensual:** en cada celda de día laborable, si hay reuniones, un
  indicador nuevo: punto azul discreto + contador pequeño (`Video` de lucide,
  `<Num>` con la cantidad). Se suma a la leyenda existente ("Reuniones" con el
  mismo punto). No desplaza los estados actuales (aprobación, carga, incidencia).
- **Panel derecho — tarjeta "Reuniones del día"** (entre el registro del día y
  "Registros cargados"):
  - Cabecera: fecha + total de horas en reuniones (`horasMinutos` tabular).
  - Una fila por reunión: hora de inicio (mono), título, organizador, duración;
    enlace "Unirme" (abre `enlaceTeams` en pestaña nueva) cuando existe.
  - Botón **"Registrar"** por reunión → pre-llena el formulario del día:
    - `fecha` = día de la reunión (selecciona el día si no lo estaba),
    - `horas` = duración redondeada a 0.25, mínimo 0.25; todoElDia → jornada
      (`cap.jornada_horas`),
    - `descripcion` = `${titulo} — organizada por ${organizador}` (cumple el
      mínimo de 10 caracteres por construcción),
    - `actividad` y `proyecto` los sigue eligiendo el usuario.
  - Estado vacío / sin cuenta: CTA "Conectar Outlook" o, en modo demo, aviso de
    que se muestran reuniones de ejemplo con toggle para apagarlo.
- **Fallos aislados:** el error de Graph se muestra dentro de esta tarjeta con
  botón "Reconectar"; el resto de la pantalla no se toca.

### 2. Pantalla nueva `Mi agenda` — `src/routes/horas.agenda.tsx`

- Ruta `/horas/agenda`, item "Mi agenda" (icono `CalendarClock`) en el grupo
  **Horas** de `src/lib/nav.ts` para `colaborador` y `jefatura`.
- Dos vistas con Tabs: **Lista** (agrupada por semana, mismo estilo de fila que la
  tarjeta del registro) y **Calendario** (rejilla mensual del periodo activo donde
  cada día lista sus reuniones en formato compacto; reutiliza el layout de rejilla
  del calendario del registro, sin sus estados de carga).
- Cabecera con el estado de la conexión (cuenta activa / demo / no conectado) y
  botones Conectar / Desconectar / activar demo.
- `head()` con meta title/description como el resto de rutas.

### 3. Punto de conexión global

- `MicrosoftProvider` monta en `src/routes/__root.tsx` junto a `SesionProvider`.
- No se toca `AppShell` más allá de nada: la conexión se gestiona dentro de las
  vistas de reuniones (Registro y Mi agenda), que son los únicos lugares con
  sentido.

## Configuración y documentación

- Variables de entorno nuevas (documentadas en `README.md` junto a los pasos de
  registro en Azure):
  - `VITE_MS_CLIENT_ID` — ID de aplicación del app registration.
  - `VITE_MS_TENANT_ID` — tenant estudiantil, o `common` para permitir cuentas
    personales + organizacionales.
- Sin client secret: flujo PKCE de cliente público.
- Redirect URIs a registrar en Azure: `http://localhost:5173` (dev) y la URL
  pública de la app (producción/Lovable).
- Archivo `.env.example` nuevo con las dos variables y comentarios.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Tenant estudiantil bloquea el registro de apps | Fallback a cuenta personal (`tenant: common`); el modo demo mantiene la presentación en pie de cualquier forma |
| El cliente corporativo exige consentimiento de TI para `Calendars.Read` | Modo demo para la presentación; conexión real cuando el admin aprueba |
| Token expira durante el uso | `acquireTokenSilent` con `loginPopup` de respaldo; error visible con CTA "Reconectar" |
| MSAL redirect URI no coincide (dev vs prod) | URI = `window.location.origin`; ambas URLs registradas en Azure |
| Rendimiento con meses muy cargados | `$select` acotado, `$top=100` + paginado, `staleTime` de 5 min |
| Scope creep hacia escritura de calendario | Fuera de alcance por spec; el permiso solicitado es únicamente `Calendars.Read` |

## Verificación

- `bun run lint` y `bun run build` limpios.
- Sin cuenta MS: la app se comporta exactamente como hoy (regresión cero).
- Con demo activado: marcadores, tarjeta del día, pre-llenado y Mi agenda
  funcionan end-to-end contra el Supabase real.
- Con cuenta real: mismo recorrido con reuniones verdaderas.
- El guardado desde una reunión produce un `hr_registro_hora` idéntico a uno
  manual (visible en "Registros cargados" y en el flujo de aprobación).
