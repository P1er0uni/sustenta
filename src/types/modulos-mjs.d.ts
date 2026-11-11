/**
 * Los módulos del agente (agente-sustentos/src/*.mjs) se importan dinámicamente
 * desde la server fn de análisis (src/lib/analizar.ts). No tienen tipos
 * propios: se tratan como any.
 */
declare module "*.mjs";
