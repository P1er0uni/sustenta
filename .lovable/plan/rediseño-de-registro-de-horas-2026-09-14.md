# Rediseño de Registro de horas

## Objetivo
Convertir `/horas/registro` en un tablero personal anclado exclusivamente al periodo abierto, conservando el registro de horas y evidencias dentro de la misma pantalla.

## Cambios
- Sustituir la navegación mensual por el periodo abierto y añadir el enlace discreto a “Mi capacidad” para consultar meses cerrados.
- Mostrar a la izquierda las asignaciones mensuales desde `hr_v_asignacion_periodo`, con empresa, vigencia, dedicación, avance de horas y una paleta fija de seis tonos suaves.
- Construir el calendario central de lunes a domingo con vigencia, dedicación individual y total, fines de semana, feriados, incidencias y estado diario de carga.
- Mantener a la derecha el formulario del día seleccionado, precargado con el proyecto activo, junto con los registros y sustentos descargables del día.
- Añadir eliminación de registros propios mientras el periodo esté abierto, mostrando literalmente cualquier rechazo de la base.
- Restringir evidencias a PDF, imágenes y documentos Office aceptados por el repositorio.
- Añadir el resumen mensual de compromisos y capacidad desde `hr_v_capacidad`.

## Reglas de cálculo
- Horas esperadas por asignación y día hábil: `jornada_horas × dedicacion_pct / 100`.
- Estado diario: verde cuando las horas registradas totales cubren la suma esperada de las asignaciones del día; ámbar cuando existe carga parcial; sin punto cuando no hay carga o el día es futuro.
- Feriados, fines de semana e incidencias no generan horas esperadas.
- Guardar o eliminar refrescará registros, tarjetas, calendario y capacidad sin recargar la página.

## Verificación
- Probar como Óscar: dos proyectos, dedicaciones 50% y 30%, avance diario y resumen mensual; crear temporalmente 4 horas el día 9, comprobar el estado ámbar y eliminar el registro.
- Probar como Rosa: vacaciones del 7 al 11 marcadas como `VAC`.
- Confirmar visualmente en escritorio y móvil, sin dejar datos nuevos al finalizar.

## Detalles técnicos
- Se reutilizarán `hr_v_asignacion_periodo`, `hr_v_registro_detalle`, `hr_v_capacidad`, `hr_feriado`, `hr_incidencia`, `hr_actividad` y `hr_sustento`.
- La pantalla seguirá usando TanStack Query y el sistema visual existente; no se crearán tablas, migraciones ni datos persistentes.
