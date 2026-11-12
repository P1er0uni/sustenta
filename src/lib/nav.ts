import type { Rol } from "@/integrations/sustenta/types";
import {
  Clock,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  BellRing,
  FolderKanban,
  Users,
  CalendarDays,
  AlertTriangle,
  Wallet,
  Lock,
  Receipt,
  ShieldCheck,
  Gauge,
  Building2,
  UserCog,
  BookMarked,
  Brain,
  type LucideIcon,
} from "lucide-react";

export type GrupoId = "horas" | "proyectos" | "administracion" | "dashboard";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: Rol[];
}

export interface NavGroup {
  id: GrupoId;
  label: string;
  roles: Rol[];
  items: NavItem[];
}

const TODOS: Rol[] = ["colaborador", "jefatura", "administracion", "finanzas", "tributaria"];

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "horas",
    label: "Horas",
    roles: ["colaborador", "jefatura", "administracion"],
    items: [
      {
        label: "Registro de horas",
        to: "/horas/registro",
        icon: Clock,
        roles: ["colaborador", "jefatura"],
      },
      {
        label: "Mi agenda",
        to: "/horas/agenda",
        icon: CalendarClock,
        roles: ["colaborador", "jefatura"],
      },
      {
        label: "Mi capacidad",
        to: "/horas/capacidad",
        icon: CalendarRange,
        roles: ["colaborador", "jefatura"],
      },
      {
        label: "Aprobaciones",
        to: "/horas/aprobaciones",
        icon: ClipboardCheck,
        roles: ["jefatura", "administracion"],
      },
    ],
  },
  {
    id: "proyectos",
    label: "Proyectos",
    roles: ["jefatura", "administracion"],
    items: [
      {
        label: "Proyectos",
        to: "/proyectos",
        icon: FolderKanban,
        roles: ["jefatura", "administracion"],
      },
      {
        label: "Asigna colaboradores",
        to: "/proyectos/asignaciones",
        icon: Users,
        roles: ["jefatura", "administracion"],
      },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    roles: ["jefatura", "administracion", "finanzas", "tributaria"],
    items: [
      {
        label: "Base de conocimiento",
        to: "/admin/base-conocimiento",
        icon: Brain,
        roles: ["jefatura", "administracion"],
      },
      {
        label: "Colaboradores",
        to: "/admin/colaboradores",
        icon: UserCog,
        roles: ["administracion"],
      },
      { label: "Catálogos", to: "/admin/catalogos", icon: BookMarked, roles: ["administracion"] },
      {
        label: "Jornada y feriados",
        to: "/admin/jornada",
        icon: CalendarDays,
        roles: ["administracion"],
      },
      {
        label: "Incidencias del personal",
        to: "/admin/incidencias",
        icon: AlertTriangle,
        roles: ["administracion"],
      },
      {
        label: "Costos del personal",
        to: "/admin/costos",
        icon: Wallet,
        roles: ["administracion", "finanzas"],
      },
      {
        label: "Periodos",
        to: "/admin/periodos",
        icon: Lock,
        roles: ["administracion", "tributaria"],
      },
      {
        label: "Liquidación",
        to: "/admin/liquidacion",
        icon: Receipt,
        roles: ["administracion", "finanzas", "tributaria"],
      },
      {
        label: "Defense file",
        to: "/admin/defense-file",
        icon: ShieldCheck,
        roles: ["administracion", "tributaria"],
      },
      {
        label: "Alertas y notificaciones",
        to: "/admin/notificaciones",
        icon: BellRing,
        roles: ["administracion"],
      },
    ],
  },
  {
    id: "dashboard",
    label: "Dashboard",
    roles: ["jefatura", "administracion", "finanzas", "tributaria"],
    items: [
      {
        label: "Capacidad del equipo",
        to: "/dashboard/capacidad",
        icon: Gauge,
        roles: ["jefatura", "administracion", "finanzas", "tributaria"],
      },
      {
        label: "Cumplimiento por empresa",
        to: "/dashboard/cumplimiento",
        icon: Building2,
        roles: ["jefatura", "administracion", "finanzas", "tributaria"],
      },
    ],
  },
];

export function gruposPorRol(rol: Rol): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(rol)),
  })).filter((g) => g.items.length > 0 && g.roles.includes(rol));
}

export function primeraRuta(rol: Rol): string {
  const grupos = gruposPorRol(rol);
  return grupos[0]?.items[0]?.to ?? "/horas/registro";
}

export const ROLES: { valor: Rol; etiqueta: string; alcance: string }[] = [
  { valor: "colaborador", etiqueta: "Colaborador", alcance: "Solo mis registros" },
  { valor: "jefatura", etiqueta: "Jefatura", alcance: "Mi equipo y mis proyectos" },
  { valor: "administracion", etiqueta: "Administración", alcance: "Todas las empresas" },
  { valor: "finanzas", etiqueta: "Finanzas", alcance: "Costos y liquidación" },
  { valor: "tributaria", etiqueta: "Tributaria", alcance: "Expedientes y periodos" },
];

export { TODOS as ROLES_TODOS };
