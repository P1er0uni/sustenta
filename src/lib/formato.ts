export const COLORES = {
  ejecutado: "#0F6E56",
  advertencia: "#A9670C",
  alerta: "#DF3E3F",
  referencia: "#C9C6C0",
};

const nf = (d: number) =>
  new Intl.NumberFormat("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });

export function n(valor: unknown, decimales = 1): string {
  const v = Number(valor);
  if (valor === null || valor === undefined || Number.isNaN(v)) return "—";
  return nf(decimales).format(v);
}

export function soles(valor: unknown, decimales = 2): string {
  const v = Number(valor);
  if (valor === null || valor === undefined || Number.isNaN(v)) return "—";
  return `S/ ${nf(decimales).format(v)}`;
}

export function horasMinutos(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "—";
  const minutosTotales = Math.round(numero * 60);
  const signo = minutosTotales < 0 ? "−" : "";
  const absolutos = Math.abs(minutosTotales);
  return `${signo}${Math.floor(absolutos / 60)}:${String(absolutos % 60).padStart(2, "0")}`;
}

export function pct(valor: unknown, decimales = 1): string {
  const v = Number(valor);
  if (valor === null || valor === undefined || Number.isNaN(v)) return "—";
  return `${nf(decimales).format(v)}%`;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function etiquetaPeriodo(anio?: number | null, mes?: number | null): string {
  if (!anio || !mes) return "—";
  return `${MESES[mes - 1]} ${anio}`;
}

export function codigoPeriodo(anio?: number | null, mes?: number | null): string {
  if (!anio || !mes) return "—";
  return `${anio}-${String(mes).padStart(2, "0")}`;
}

/** Rango [inicio, fin] del mes en formato ISO. */
export function rangoMes(anio: number, mes: number): { inicio: string; fin: string } {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return {
    inicio: `${anio}-${String(mes).padStart(2, "0")}-01`,
    fin: `${anio}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`,
  };
}

export function esFinDeSemana(iso: string): boolean {
  const partes = iso.split("-").map(Number);
  const dia = new Date(Date.UTC(partes[0] ?? 1970, (partes[1] ?? 1) - 1, partes[2] ?? 1)).getUTCDay();
  return dia === 0 || dia === 6;
}

export function fechaCorta(iso?: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
