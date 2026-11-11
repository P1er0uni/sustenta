# Plan NNN — <Título corto de la feature>

> Derivado de `spec.md`. Si el plan descubre un hueco en la spec, se corrige la spec
> primero. Borra este aviso.

## Arquitectura

<Cómo encaja la feature en la app: rutas, providers, módulos nuevos. Qué se reusa
y qué se crea. Diagrama breve en texto si ayuda.>

## Archivos

| Acción | Ruta | Propósito |
|--------|------|-----------|
| crear | `src/...` | ... |
| modificar | `src/...` | ... |

## Estado y datos

<React Query: queries/mutations, claves, invalidaciones. RPC de Supabase a invocar
(NUNCA lógica de negocio en el cliente — ver README). Tablas y columnas que se leen.>

## UI

<Por pantalla: layout, componentes, estados vacíos, estados de carga y error. Respetar
la identidad visual del README (tokens, Montserrat, IBM Plex Mono tabular para cifras,
lucide-react).>

## Riesgos y mitigaciones

- **<Riesgo>** → <mitigación>.

## Verificación

<Cómo se comprueba que la spec se cumple: pasos manuales en la app, casos de la
lista en EARS cubiertos uno a uno.>
