import { format, parseISO } from "date-fns";
import { obtenerTokenGraph } from "./client";
import type { Reunion } from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Evento crudo de Microsoft Graph; solo los campos que pedimos con $select. */
interface EventoGraph {
  id: string;
  subject?: string | null;
  isAllDay?: boolean | null;
  bodyPreview?: string | null;
  start?: { dateTime?: string | null } | null;
  end?: { dateTime?: string | null } | null;
  organizer?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null;
  attendees?: unknown[] | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
}

/** Offset horario de Lima: Graph lo exige explícito en el rango de calendarview. */
const OFFSET_LIMA = "-05:00";

function aReunion(evento: EventoGraph): Reunion | null {
  const inicio = evento.start?.dateTime ?? null;
  const fin = evento.end?.dateTime ?? null;
  if (!inicio || !fin) return null;
  const organizador =
    evento.organizer?.emailAddress?.name ?? evento.organizer?.emailAddress?.address ?? null;
  return {
    id: evento.id,
    titulo: (evento.subject ?? "").trim() || "Reunión sin título",
    inicio,
    fin,
    dia: format(parseISO(inicio), "yyyy-MM-dd"),
    organizador,
    asistentes: Array.isArray(evento.attendees) ? evento.attendees.length : 0,
    enlaceTeams: evento.onlineMeeting?.joinUrl ?? null,
    todoElDia: !!evento.isAllDay,
    previa: (evento.bodyPreview ?? "").trim() || null,
    origen: "microsoft",
  };
}

/**
 * Reuniones del propio calendario entre dos fechas ISO (yyyy-MM-dd).
 * Pide la zona horaria de Lima para recibir horas locales directas.
 */
export async function reunionesDeRango(inicio: string, fin: string): Promise<Reunion[]> {
  const token = await obtenerTokenGraph();
  const url = new URL(`${GRAPH}/me/calendarview`);
  url.searchParams.set("startDateTime", `${inicio}T00:00:00${OFFSET_LIMA}`);
  url.searchParams.set("endDateTime", `${fin}T23:59:59${OFFSET_LIMA}`);
  url.searchParams.set(
    "$select",
    "id,subject,start,end,organizer,attendees,onlineMeeting,bodyPreview,isAllDay",
  );
  url.searchParams.set("$top", "100");

  const reuniones: Reunion[] = [];
  let siguiente: string | null = url.toString();
  while (siguiente) {
    const respuesta = await fetch(siguiente, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="America/Lima"',
      },
    });
    if (!respuesta.ok) {
      throw new Error(`Microsoft Graph respondió ${respuesta.status} ${respuesta.statusText}`);
    }
    const pagina = (await respuesta.json()) as {
      value?: EventoGraph[];
      "@odata.nextLink"?: string;
    };
    for (const evento of pagina.value ?? []) {
      const reunion = aReunion(evento);
      if (reunion) reuniones.push(reunion);
    }
    siguiente = pagina["@odata.nextLink"] ?? null;
  }
  return reuniones.sort((a, b) => a.inicio.localeCompare(b.inicio));
}
