import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function KPIGrid({ children, columnas = 4 }: { children: ReactNode; columnas?: 2 | 3 | 4 | 6 }) {
  return (
    <div
      className={cn(
        "mb-5 grid gap-3",
        columnas === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        columnas === 6 && "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
        columnas === 3 && "sm:grid-cols-3",
        columnas === 2 && "sm:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

export function KPI({
  etiqueta,
  valor,
  unidad,
  nota,
  tono = "neutro",
  grande,
}: {
  etiqueta: string;
  valor: string;
  unidad?: string;
  nota?: ReactNode;
  tono?: "neutro" | "exito" | "alerta" | "advertencia";
  grande?: boolean;
}) {
  const color =
    tono === "exito"
      ? "text-success"
      : tono === "alerta"
        ? "text-accent"
        : tono === "advertencia"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="card-surface px-4 py-3">
      <p className="label-xs">{etiqueta}</p>
      <p className={cn("num mt-1 font-semibold tabular-nums", grande ? "text-[30px]" : "text-[24px]", color)}>
        {valor}
        {unidad ? <span className="ml-1 text-[13px] font-medium text-muted-foreground">{unidad}</span> : null}
      </p>
      {nota ? <p className="mt-0.5 text-[12px] text-muted-foreground">{nota}</p> : null}
    </div>
  );
}

export function BarraH({
  etiqueta,
  detalle,
  valor,
  maximo,
  color,
}: {
  etiqueta: string;
  detalle?: string;
  valor: number;
  maximo: number;
  color: string;
}) {
  const pct = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] text-foreground">{etiqueta}</span>
        <span className="num shrink-0 text-[12px] tabular-nums text-muted-foreground">{detalle}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
