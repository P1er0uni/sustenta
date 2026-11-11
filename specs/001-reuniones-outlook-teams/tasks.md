# Tasks 001 — Reuniones de Outlook/Teams en Sustenta

Tareas derivadas de `plan.md`. Marcar `[x]` al completar y anotar desviaciones bajo
"Notes". El orden respeta dependencias; dentro de una fase el orden es libre.

## Fase 1 — Cimiento de la integración

- [x] 1.1 Instalar `@azure/msal-browser` (bun) y crear `.env.example` con
      `VITE_MS_CLIENT_ID` / `VITE_MS_TENANT_ID` comentadas.
- [x] 1.2 `src/integrations/microsoft/types.ts`: tipo `Reunion` según plan
      (`id, titulo, inicio, fin, dia, organizador, asistentes, enlaceTeams,
      todoElDia, previa, origen`).
- [x] 1.3 `src/integrations/microsoft/client.ts`: instancia MSAL (PKCE,
      sessionStorage, redirect = `window.location.origin`), `msConfigurado`,
      `conectarMicrosoft`, `desconectarMicrosoft`, `cuentaMicrosoftActiva`,
      `obtenerTokenGraph` (ámbito `Calendars.Read`).
- [x] 1.4 `src/integrations/microsoft/graph.ts`: `reunionesDeRango(inicio, fin)`
      con `GET /me/calendarview`, `$select` acotado, `Prefer:
      outlook.timezone="America/Lima"`, `$top=100` + paginado, normalización a
      `Reunion` (descarta eventos sin inicio; `dia` con date-fns).
- [x] 1.5 `src/integrations/microsoft/demo.ts`: `reunionesDemo(anio, mes)`
      determinista con los cinco arquetipos del plan, días laborables del mes,
      `origen: "demo"`, ids sintéticos.

## Fase 2 — Estado y hooks

- [x] 2.1 `src/context/microsoft.tsx`: `MicrosoftProvider` con
      `cuentaActiva`, `modoDemo` (sessionStorage, deshabilitado si hay cuenta),
      `conectar`, `desconectar`, `alternarDemo`.
- [x] 2.2 Montar `MicrosoftProvider` en `src/routes/__root.tsx` junto a
      `SesionProvider`.
- [x] 2.3 `src/integrations/microsoft/hooks.ts`: `useCuentaMicrosoft()` y
      `useReuniones(rango)` con las tres fuentes (Graph / demo / vacío) y
      `staleTime: 5 min`, `retry: 1`.

## Fase 3 — Registro de horas

- [x] 3.1 Calendario mensual (`horas.registro.tsx`): indicador de reuniones por
      celda (icono `Video` + `<Num>` con cantidad) y entrada nueva en la leyenda.
- [x] 3.2 Tarjeta "Reuniones del día" en el panel derecho: filas con hora,
      título, organizador, duración, enlace "Unirme" y botón "Registrar";
      total de horas del día en cabecera.
- [x] 3.3 Pre-llenado desde reunión: selecciona el día, setea `horas`
      (duración → múltiplos de 0.25, mínimo 0.25; todoElDia → jornada de
      `hr_v_capacidad`), `descripcion` = "título — organizada por organizador";
      actividad/proyecto siguen siendo elección del usuario.
- [x] 3.4 Estados de la tarjeta: sin cuenta (CTA conectar), demo (aviso +
      toggle), error de Graph (mensaje + "Reconectar"), día sin reuniones (vacío).
- [ ] 3.5 Verificar que guardar desde una reunión crea un `hr_registro_hora`
      normal: aparece en "Registros cargados", entra al flujo de envío/aprobación
      y no persiste nada de la reunión.

## Fase 4 — Mi agenda

- [x] 4.1 Ruta `src/routes/horas.agenda.tsx` (`/horas/agenda`) con `head()` y
      layout `AppShell` + `PageHeader`.
- [x] 4.2 Vista Lista: reuniones del periodo agrupadas por semana, mismo estilo
      de fila que la tarjeta del registro.
- [x] 4.3 Vista Calendario: rejilla mensual del periodo con las reuniones
      compactas por celda (sin estados de carga del registro).
- [x] 4.4 Cabecera de conexión: estado (cuenta activa / demo / no conectado) con
      Conectar / Desconectar / activar demo.
- [x] 4.5 Item "Mi agenda" (icono `CalendarClock`) en el grupo Horas de
      `src/lib/nav.ts` para `colaborador` y `jefatura`.

## Fase 5 — Documentación y verificación

- [x] 5.1 README: sección "Conectar Outlook/Teams" con pasos del app registration
      en Azure (cuenta estudiantil o personal, redirect URIs, `Calendars.Read`,
      tenant `common`) y las dos variables de entorno.
- [x] 5.2 `bun run lint` y `bun run build` limpios.
- [ ] 5.3 Prueba de regresión sin cuenta MS ni demo: la app se comporta
      exactamente como hoy.
- [ ] 5.4 Recorrido completo en modo demo: marcadores → tarjeta del día →
      pre-llenado → guardado → envío a aprobación.
- [ ] 5.5 Recorrido con cuenta real de Microsoft (requiere app registrado en
      Azure; anotar aquí el client ID usado y cualquier fricción de consentimiento).

## Notes

- Instalación hecha con npm (bun no disponible en la máquina); se generó
  `package-lock.json` junto al `bun.lock` existente.
- `npm run lint` en Windows reporta ~14k errores `Delete ␍` en TODOS los
  archivos (incluidos intactos como `vite.config.ts`): es el checkout CRLF de
  `core.autocrlf=true`, no un problema del código. ESLint sobre los archivos
  nuevos/modificados da 0 errores. Al commitear, git renormaliza a LF.
- 3.5 / 5.3 / 5.4 requieren sesión iniciada en Supabase con un periodo abierto:
  pendientes de recorrido interactivo. El guardado desde reunión usa el mismo
  `insert` de `hr_registro_hora` que el registro manual (misma mutación
  `guardar`), por construcción no persiste nada de la reunión.
- 5.5 bloqueado hasta tener el app registration en Azure (decisión del usuario:
  todo listo para conectar; falta solo completar `.env`).
