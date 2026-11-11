import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Card, Vacio } from "@/components/ui-kit";

export function Proximamente({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <AppShell>
      <PageHeader titulo={titulo} descripcion={descripcion} />
      <Card>
        <Vacio mensaje="Esta pantalla llega en la siguiente entrega." />
      </Card>
    </AppShell>
  );
}

export function metaProximamente(titulo: string, descripcion: string) {
  return {
    meta: [
      { title: `${titulo} — Sustenta` },
      { name: "description", content: descripcion },
      { property: "og:title", content: `${titulo} — Sustenta` },
      { property: "og:description", content: descripcion },
    ],
  };
}
