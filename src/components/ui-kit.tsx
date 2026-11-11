import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-surface", className)} {...props} />;
}

export function CardHeader({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        {descripcion ? <p className="mt-0.5 text-xs text-muted-foreground">{descripcion}</p> : null}
      </div>
      {accion}
    </div>
  );
}

type Variante = "primario" | "secundario" | "fantasma" | "peligro";

const variantes: Record<Variante, string> = {
  primario: "bg-accent text-accent-foreground hover:brightness-95 border border-transparent",
  secundario: "bg-surface text-foreground border border-border-strong hover:bg-surface-muted",
  fantasma: "bg-transparent text-muted-foreground border border-transparent hover:bg-surface-muted",
  peligro: "bg-transparent text-accent border border-border-strong hover:bg-accent-soft",
};

export function Button({
  variante = "secundario",
  cargando,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variantes[variante],
        className,
      )}
      disabled={props.disabled || cargando}
      {...props}
    >
      {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

type Tono = "neutro" | "exito" | "alerta" | "acento" | "info";

const tonos: Record<Tono, string> = {
  neutro: "bg-surface-muted text-muted-foreground border-border",
  exito: "bg-success-soft text-success border-success/20",
  alerta: "bg-warning-soft text-warning border-warning/20",
  acento: "bg-accent-soft text-accent border-accent/20",
  info: "bg-info-soft text-info border-info/20",
};

export function Badge({
  tono = "neutro",
  children,
  className,
}: {
  tono?: Tono;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tonos[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}

export function Progress({ valor }: { valor: number }) {
  const pct = Math.max(0, Math.min(100, valor));
  const color = pct > 100 ? "bg-accent" : pct >= 80 ? "bg-warning" : "bg-success";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Aviso({
  tono = "alerta",
  titulo,
  children,
}: {
  tono?: Tono;
  titulo?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-[6px] border px-3 py-2 text-[13px]", tonos[tono])}>
      {titulo ? <p className="font-semibold">{titulo}</p> : null}
      <div className="font-normal normal-case tracking-normal">{children}</div>
    </div>
  );
}

export function Vacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">{mensaje}</div>
  );
}

export function Etiqueta({ children }: { children: ReactNode }) {
  return <span className="label-xs block">{children}</span>;
}
