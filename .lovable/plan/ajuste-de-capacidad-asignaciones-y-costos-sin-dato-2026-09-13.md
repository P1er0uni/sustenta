# Ajuste de capacidad, asignaciones y costos sin dato

## Resultado esperado

La interfaz distinguirá claramente entre capacidad planificada, capacidad sin asignar, costos pendientes y costos no calculables. Las comparaciones mensuales usarán únicamente datos del periodo seleccionado.

## Cambios

1. **Asignaciones mensuales**
   - Incorporar el tipo de datos de `hr_v_asignacion_periodo`, incluyendo periodo, horas esperadas y registradas.
   - En **Mi capacidad**, consultar esa vista filtrada por colaborador y periodo.
   - En **Asigna colaboradores**, agregar selector de periodo y reemplazar el acumulado de vigencia por `horas_registradas / horas_esperadas` del mes.
   - Mantener `hr_v_asignacion_detalle` en Registro de horas, donde se necesita la vigencia para elegir proyectos, no una comparación mensual.

2. **Composición completa de capacidad**
   - Ampliar `hr_v_capacidad` con `dedicacion_total_pct`, `horas_sin_asignar` y `costo_cargado`.
   - Mostrar en **Mi capacidad** los seis valores enumerados: bruta, incidencias, productiva, planificada, sin asignar y registrada, en formato `HH:MM`.
   - Añadir un aviso ámbar cuando exista capacidad sin asignar, indicando el porcentaje exacto.
   - Ajustar la grilla de indicadores para seis elementos sin perder legibilidad en móvil o escritorio.
   - En **Capacidad del equipo**, alimentar la dona con `horas_sin_asignar` de la vista, evitando inferirlo a partir de registros, y mantenerlo como segmento independiente.

3. **Semántica de costos**
   - En **Costos del personal**, usar `costo_cargado` como fuente de verdad:
     - `false`: “Sin cargar”, en gris.
     - `true` con costo por hora nulo: “No calculable”, en rojo.
     - `true` con valor, incluido cero: mostrar el importe real.
   - En **Mi capacidad** y **Capacidad del equipo**, mostrar el mismo estado sin convertir nulos en cero.
   - En **Cumplimiento por empresa**, no mostrar `S/ 0.00` cuando no existan costos/liquidación; mostrar “Liquidación no calculada”.
   - En **Liquidación**, reforzar el estado vacío como “liquidación no calculada” y conservar margen 0% como valor válido con su distintivo “a costo puro”.

## Detalles técnicos

- Añadir un formateador de horas decimales a `HH:MM`, con redondeo estable de minutos.
- Evitar condiciones basadas en valores truthy (`!costo_hora`), porque confunden cero con ausencia.
- Preservar los mensajes literales de la base en todas las consultas y operaciones.
- Validar con datos reales que Óscar muestre 24:00/88:00 y 14:24/52:48, 35:12 sin asignar y 38:24 registrados.
- Verificar en navegador los tres estados de costo y que septiembre sin costos nunca presente importes como cero.
