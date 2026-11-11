# Spec 001 — Reuniones de Outlook/Teams en Sustenta

## WHY

Los colaboradores de AC Corporativo pasan gran parte de su jornada en reuniones de
Microsoft Teams / Outlook. Hoy, al registrar horas en Sustenta, deben recordar qué
hicieron cada día sin ningún apoyo visual. Mostrar las reuniones programadas dentro
de la propia plataforma y permitir convertirlas en registros de horas reduce el
esfuerzo de registro, mejora la fidelidad de la descripción y fortalece el sustento
de la defensa tributaria: la reunión es evidencia de cómo se usó el tiempo.

## WHAT

### Historias de usuario

1. **Conectar cuenta.** Como colaborador, quiero conectar mi cuenta de Microsoft
   (Outlook/Teams) con un clic, para que Sustenta pueda leer mis reuniones
   programadas.
2. **Marcadores en el calendario.** Como colaborador, quiero ver en el calendario
   mensual del Registro de horas qué días tienen reuniones, para ubicar de inmediato
   dónde estuvo mi tiempo.
3. **Reuniones del día.** Como colaborador, al seleccionar un día del calendario,
   quiero ver la lista de reuniones de ese día: título, horario de inicio/fin,
   organizador y enlace para unirme por Teams.
4. **Convertir reunión en registro.** Como colaborador, quiero un botón "Registrar"
   en cada reunión que pre-llene el formulario del día con fecha, horas según la
   duración y descripción con el título de la reunión, para registrar en segundos.
5. **Mi agenda.** Como colaborador, quiero una pantalla "Mi agenda" con todas las
   reuniones del periodo activo, en lista y en calendario, como referencia general.
6. **Modo demo.** Como presentador de la demo comercial, quiero ver el
   comportamiento completo con reuniones de ejemplo cuando no hay cuenta Microsoft
   conectada, para que la presentación nunca dependa del consentimiento del cliente.
7. **Desconectar.** Como colaborador, quiero desconectar mi cuenta de Microsoft y
   que Sustenta deje de leer mi calendario.

### Requisitos funcionales (EARS)

- **WHEN** el usuario pulsa "Conectar Outlook" **THEN** se abre el flujo OAuth 2.0
  con PKCE (MSAL.js) solicitando el permiso delegado `Calendars.Read` de Microsoft
  Graph y, al autorizar, la cuenta queda conectada en ese navegador.
- **WHEN** hay una cuenta conectada **THEN** la app consulta
  `GET /me/calendarview` de Microsoft Graph para el rango del periodo activo y
  muestra las reuniones en el calendario, en el panel del día y en Mi agenda.
- **WHEN** no hay cuenta conectada **THEN** las secciones de reuniones muestran la
  invitación a conectar y, si el modo demo está activado, reuniones de ejemplo
  generadas para el mes del periodo activo.
- **WHEN** el usuario pulsa "Registrar" en una reunión **THEN** el formulario del
   día se pre-llena con la fecha de la reunión, las horas según su duración
  (redondeadas a múltiplos de 0.25) y una descripción con título y organizador
  (mínimo 10 caracteres); el registro **nunca** se guarda sin confirmación
  explícita del usuario.
- **IF** la reunión dura menos de 15 minutos **THEN** se proponen 0.25 horas
  como mínimo.
- **IF** la reunión es de día completo (sin hora de fin o > 8 h) **THEN** se
  proponen las horas de jornada del colaborador y la descripción pide aclarar el
  trabajo realizado.
- **WHEN** se guarda un registro originado en una reunión **THEN** se inserta en
  `hr_registro_hora` exactamente como cualquier registro manual, sin cambios en la
  base de datos ni persistencia de la reunión.
- **IF** Microsoft Graph responde con error (token expirado, consentimiento
  retirado, red) **THEN** se muestra el mensaje tal cual y se ofrece reconectar;
  el resto de la pantalla de registro sigue funcionando con normalidad.
- **WHEN** el usuario desconecta su cuenta **THEN** se limpia la caché de MSAL y
  las secciones de reuniones vuelven al estado inicial.

### Requisitos no funcionales

- **Solo lectura.** La app jamás escribe, modifica ni borra eventos del calendario
  de Microsoft.
- **Sin persistencia de reuniones.** Las reuniones viven solo en memoria del
  navegador (React Query); Supabase no almacena nada nuevo.
- **Esquema `horas` intocable.** Sin migraciones, sin tablas nuevas, sin RPCs
  nuevas. La reunión se convierte en un `hr_registro_hora` común.
- **Fallos aislados.** Un error de Microsoft nunca rompe el registro de horas:
  las secciones de reuniones degradan con mensaje y CTA de reconexión.
- **Identidad visual.** Misma estética financiera sobria (Montserrat, IBM Plex Mono
  tabular para horas/fechas, lucide-react, acento `#DF3E3F` solo en acciones).
- **Roles.** Reuniones y Mi agenda son visibles para `colaborador` y `jefatura`
  (quienes registran horas). Los demás roles no ven nada nuevo.

### Fuera de alcance

- Crear, editar o eliminar eventos en el calendario de Microsoft.
- Guardar reuniones o tokens en Supabase o en cualquier base de datos.
- Registros automáticos sin confirmación del usuario.
- Sugerencia automática de horas pendientes (jornada − reuniones); se evalúa en
  una fase posterior.
- Notificaciones de próximas reuniones.
- Sincronización con calendarios compartidos o de terceros (`/me` únicamente).

## HOW (decisión técnica resumida)

- **MSAL.js** (`@azure/msal-browser`) con flujo de código de autorización + PKCE,
  cliente público SPA: no existe client secret. Configuración por variables de
  entorno `VITE_MS_CLIENT_ID` y `VITE_MS_TENANT_ID`; redirect URI = origen de la
  app (`window.location.origin`), registrado en Azure para localhost y producción.
- **Microsoft Graph** `GET /v1.0/me/calendarview` con `startDateTime`/`endDateTime`
  del periodo activo, `$select` acotado (subject, start, end, organizer,
  onlineMeeting, bodyPreview) y `Prefer: outlook.timezone="America/Lima"` para
  horas locales directas.
- **Modo demo**: generador determinista de reuniones realistas para el mes del
  periodo activo (kickoff, seguimiento semanal, revisión de defense file…),
  activable solo cuando no hay sesión de Microsoft.
- Detalle completo en `plan.md`; tareas en `tasks.md`.
