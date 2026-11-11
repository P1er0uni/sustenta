# Sustenta — plataforma de control de horas y defensa tributaria

Demo comercial de Claro Empresas para AC Corporativo del Perú S.A.C. Toda la lógica vive en la base de datos existente; este trabajo es exclusivamente interfaz.

## Lo que necesito de ti antes de empezar

Para leer los datos del proyecto Supabase existente (`gjgezgdnpecyffjpxdep`) hace falta su **clave pública (anon / publishable)**. Dos opciones:

1. Pegármela aquí y la guardo como secreto del proyecto, o
2. Conectar tu propio Supabase desde Configuración del proyecto → Conectores → Supabase.

También hay que confirmar que el esquema `horas` esté **expuesto en la API** (Settings → API → Exposed schemas) y que las funciones RPC sean invocables; si no, las llamadas fallan aunque la interfaz esté lista.

## Identidad visual

Sistema de diseño nuevo en `src/styles.css`, sin estética shadcn por defecto:

- Fondo `#F6F5F3`, superficies `#FFFFFF`, bordes `#E4E2DE`
- Barra lateral `#171A1F` con texto `#C6C8CC`
- Acento Claro `#DF3E3F` solo en acción primaria, estado activo y alertas
- Verde `#0F6E56` sobre `#E4F2EE`; ámbar `#A9670C` sobre `#FBF0DC`
- Texto `#1B1E24` / `#61656E`; radios 6px controles, 8px tarjetas; sombras mínimas
- Montserrat en toda la interfaz; IBM Plex Mono con `tabular-nums` en toda cifra (horas, montos, fechas, documentos, porcentajes) mediante una utilidad `.num`
- Iconos: lucide-react

## Navegación

Barra lateral oscura con grupos colapsables filtrados por `colaborador.rol`, auto-expandiendo los del rol activo:

- **Horas**: Registro de horas · Mi capacidad
- **Proyectos**: Proyectos · Asigna colaboradores
- **Administración**: Jornada y feriados · Incidencias · Costos · Periodos · Liquidación · Defense file
- **Dashboard**: Capacidad del equipo · Cumplimiento por empresa

Alcance: `colaborador` → Horas · `jefatura` → Horas, Proyectos, Dashboard · `administracion` → todo salvo Horas · `finanzas` → Costos, Liquidación, Dashboard · `tributaria` → Defense file, Periodos, Liquidación, Dashboard.

Barra superior: periodo activo con su estado, indicador de alcance de datos, campana de notificaciones y bloque de usuario. Bajo el título de cada pantalla, fila de acciones rápidas del rol con contador de pendientes.

Como la demo aún no tiene inicio de sesión, el rol activo se toma del colaborador seleccionado en el bloque de usuario (conmutador de rol para la demo). Si prefieres login real, lo agrego después.

## Pantallas de esta primera entrega

### 1. Registro de horas
Izquierda: selector de proyecto limitado a asignaciones vigentes y calendario mensual que solo habilita fechas dentro de la vigencia, con estados por día (completo, parcial, pendiente, incidencia, no laborable, feriado). Derecha: día seleccionado con actividad del catálogo, horas, descripción obligatoria de mínimo 10 caracteres y carga de evidencia al bucket `sustentos`. Debajo, tarjeta "Cómo se clasificó este registro" con cobrabilidad, empresa receptora y canal, en solo lectura.

### 2. Asigna colaboradores
Tabla de asignaciones del proyecto: colaborador, rol, dedicación, vigencia, cobrabilidad y capacidad usada con barra de progreso; editar y eliminar por fila. Si la base rechaza el borrado por horas registradas, se muestra su mensaje tal cual y se ofrece cerrar la asignación anticipadamente ajustando la fecha de fin.

### 3. Defense file
Selector de empresa vinculada y periodo cerrado, botón de generación vía RPC y despliegue del JSON en secciones: naturaleza del servicio, personal asignado (exclusivo/compartido), horas incurridas, criterio de asignación, valorización con margen e informe de completitud. Panel lateral de sellado: en "propuesto" muestra confirmar; al confirmarse muestra hash SHA-256, responsable y fecha, y bloquea el expediente.

## Detalles técnicos

- Cliente Supabase propio en `src/integrations/sustenta/client.ts` con `db: { schema: "horas" }`, usando `VITE_SUSTENTA_SUPABASE_URL` y `VITE_SUSTENTA_SUPABASE_ANON_KEY`. No se crea Lovable Cloud ni migraciones.
- Lecturas y escrituras con TanStack Query; mutaciones a RPC (`checklist_cierre`, `cerrar_periodo`, `calcular_costos`, `generar_defense_file`, `confirmar_defense_file`) sin validación previa: el `error.message` de la base se muestra íntegro en un toast y en el formulario.
- Rutas: `/horas/registro`, `/proyectos/asignaciones`, `/admin/defense-file`, más un layout compartido con barra lateral y barra superior; `/` redirige a la primera pantalla permitida del rol.
- Sin tipos generados: se definen tipos TypeScript manuales para las tablas usadas.
- Subida de evidencia al bucket `sustentos` desde el navegador y registro de la fila en `sustento`.

## Después de esta entrega

Periodos, costos, liquidación y dashboards.
