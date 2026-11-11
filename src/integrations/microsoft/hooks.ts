import { useQuery } from "@tanstack/react-query";
import { useCuentaMicrosoft } from "@/context/microsoft";
import { reunionesDemo } from "./demo";
import { reunionesDeRango } from "./graph";
import type { Reunion } from "./types";

export interface RangoReuniones {
  inicio: string;
  fin: string;
  anio: number;
  mes: number;
}

/**
 * Reuniones del rango según el origen activo:
 * cuenta Microsoft → Graph · modo demo → generador · resto → lista vacía.
 * Los errores de Graph se degradan dentro de la UI de reuniones, nunca rompen
 * el resto de la pantalla.
 */
export function useReuniones(rango: RangoReuniones | null) {
  const { cuenta, modoDemo } = useCuentaMicrosoft();
  const origen = cuenta ? "microsoft" : modoDemo ? "demo" : "ninguno";

  return useQuery<Reunion[]>({
    queryKey: ["reuniones", rango?.inicio ?? "", rango?.fin ?? "", origen],
    enabled: !!rango && origen !== "ninguno",
    queryFn: async () => {
      if (!rango) return [];
      if (origen === "microsoft") return reunionesDeRango(rango.inicio, rango.fin);
      return reunionesDemo(rango.anio, rango.mes);
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
