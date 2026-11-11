import { useState } from "react";
import { useSesion } from "@/context/session";
import type { Periodo } from "@/integrations/sustenta/types";
import { codigoPeriodo, etiquetaPeriodo } from "@/lib/formato";

export function usePeriodoSeleccionado(soloCerrados = false) {
  const { periodos, periodoActivo } = useSesion();
  const disponibles = soloCerrados
    ? periodos.filter((p) => (p.estado ?? "").toLowerCase() === "cerrado")
    : periodos;
  const [id, setId] = useState<string>("");
  const periodo: Periodo | null =
    disponibles.find((p) => p.id === id) ??
    (soloCerrados ? (disponibles[0] ?? null) : (periodoActivo ?? disponibles[0] ?? null));
  return { periodo, periodoId: periodo?.id ?? "", setPeriodoId: setId, periodos: disponibles };
}

export function SelectorPeriodo({
  periodos,
  valor,
  onChange,
}: {
  periodos: Periodo[];
  valor: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="label-xs">Periodo</span>
      <select className="field num" value={valor} onChange={(e) => onChange(e.target.value)}>
        {periodos.length === 0 ? <option value="">Sin periodos</option> : null}
        {periodos.map((p) => (
          <option key={p.id} value={p.id}>
            {codigoPeriodo(p.anio, p.mes)} · {etiquetaPeriodo(p.anio, p.mes)} ({p.estado})
          </option>
        ))}
      </select>
    </div>
  );
}
