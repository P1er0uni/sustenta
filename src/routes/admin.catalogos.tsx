import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/catalogos")({
  head: () => ({
    meta: [
      { title: "Catálogos — Sustenta" },
      {
        name: "description",
        content: "Perfiles profesionales y actividades: los catálogos que clasifican al personal y a las horas.",
      },
      { property: "og:title", content: "Catálogos — Sustenta" },
      { property: "og:description", content: "Perfiles profesionales y actividades cobrables o no cobrables." },
    ],
  }),
  component: Catalogos,
});

interface Perfil {
  id: string;
  codigo: string | null;
  nombre: string | null;
  descripcion: string | null;
  orden: number | null;
  activo: boolean | null;
}

interface ActividadFila {
  id: string;
  codigo: string | null;
  nombre: string | null;
  cobrable: boolean | null;
  activo: boolean | null;
}

const PERFIL_VACIO = { codigo: "", nombre: "", descripcion: "", orden: "10", activo: true };
const ACTIVIDAD_VACIA = { codigo: "", nombre: "", cobrable: true, activo: true };

function Catalogos() {
  const qc = useQueryClient();
  const { rol } = useSesion();
  const puedeEditar = rol === "administracion";
  const [pestana, setPestana] = useState<"perfiles" | "actividades">("perfiles");
  const [error, setError] = useState<string | null>(null);

  const [perfilEdit, setPerfilEdit] = useState<Perfil | "nuevo" | null>(null);
  const [perfilForm, setPerfilForm] = useState({ ...PERFIL_VACIO });
  const [actEdit, setActEdit] = useState<ActividadFila | "nuevo" | null>(null);
  const [actForm, setActForm] = useState({ ...ACTIVIDAD_VACIA });

  const perfilesQ = useQuery({
    queryKey: ["perfiles"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_perfil_profesional").select("*").order("orden");
      if (err) throw err;
      return (data ?? []) as Perfil[];
    },
  });

  const actividadesQ = useQuery({
    queryKey: ["actividades-catalogo"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_actividad").select("*").order("codigo");
      if (err) throw err;
      return (data ?? []) as ActividadFila[];
    },
  });

  const guardarPerfil = useMutation({
    mutationFn: async () => {
      const fila = {
        codigo: perfilForm.codigo.trim(),
        nombre: perfilForm.nombre.trim(),
        descripcion: perfilForm.descripcion.trim() || null,
        orden: Number(perfilForm.orden) || 0,
        activo: perfilForm.activo,
      };
      if (perfilEdit && perfilEdit !== "nuevo") {
        const { error: err } = await sustenta.from("hr_perfil_profesional").update(fila).eq("id", perfilEdit.id);
        if (err) throw err;
      } else {
        const { error: err } = await sustenta.from("hr_perfil_profesional").insert(fila);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      setError(null);
      setPerfilEdit(null);
      toast.success("Perfil guardado");
      void qc.invalidateQueries({ queryKey: ["perfiles"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const desactivarPerfil = useMutation({
    mutationFn: async (p: Perfil) => {
      const { error: err } = await sustenta
        .from("hr_perfil_profesional")
        .update({ activo: !p.activo })
        .eq("id", p.id);
      if (err) throw err;
    },
    onSuccess: () => {
      toast.success("Perfil actualizado");
      void qc.invalidateQueries({ queryKey: ["perfiles"] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const guardarActividad = useMutation({
    mutationFn: async () => {
      const fila = {
        codigo: actForm.codigo.trim(),
        nombre: actForm.nombre.trim(),
        cobrable: actForm.cobrable,
        activo: actForm.activo,
      };
      if (actEdit && actEdit !== "nuevo") {
        const { error: err } = await sustenta.from("hr_actividad").update(fila).eq("id", actEdit.id);
        if (err) throw err;
      } else {
        const { error: err } = await sustenta.from("hr_actividad").insert(fila);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      setError(null);
      setActEdit(null);
      toast.success("Actividad guardada");
      void qc.invalidateQueries({ queryKey: ["actividades-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["actividades"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  function abrirPerfil(p: Perfil | "nuevo") {
    setError(null);
    setPerfilEdit(p);
    setPerfilForm(
      p === "nuevo"
        ? { ...PERFIL_VACIO }
        : {
            codigo: p.codigo ?? "",
            nombre: p.nombre ?? "",
            descripcion: p.descripcion ?? "",
            orden: String(p.orden ?? 10),
            activo: p.activo !== false,
          },
    );
  }

  function abrirActividad(a: ActividadFila | "nuevo") {
    setError(null);
    setActEdit(a);
    setActForm(
      a === "nuevo"
        ? { ...ACTIVIDAD_VACIA }
        : {
            codigo: a.codigo ?? "",
            nombre: a.nombre ?? "",
            cobrable: a.cobrable !== false,
            activo: a.activo !== false,
          },
    );
  }

  const perfiles = perfilesQ.data ?? [];
  const actividades = actividadesQ.data ?? [];

  return (
    <AppShell>
      <PageHeader
        titulo="Catálogos"
        descripcion="Los perfiles clasifican al personal; las actividades clasifican cada hora registrada."
      />

      <div className="mb-4 flex gap-1 border-b border-border">
        {([
          ["perfiles", "Perfiles profesionales"],
          ["actividades", "Actividades"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold",
              pestana === id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
        </div>
      ) : null}

      {pestana === "perfiles" ? (
        <Card>
          <CardHeader
            titulo="Perfiles profesionales"
            descripcion="Definen la especialidad del colaborador; el expediente los usa para sustentar la idoneidad del personal."
            accion={
              puedeEditar ? (
                <Button variante="primario" onClick={() => abrirPerfil("nuevo")}>
                  <Plus className="h-3.5 w-3.5" />
                  Nuevo perfil
                </Button>
              ) : null
            }
          />
          {perfilesQ.isLoading ? (
            <Vacio mensaje="Cargando perfiles…" />
          ) : perfiles.length === 0 ? (
            <Vacio mensaje="No hay perfiles registrados." />
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Código</th>
                  <th className="px-4 py-2 label-xs">Nombre</th>
                  <th className="px-4 py-2 label-xs">Descripción</th>
                  <th className="px-4 py-2 label-xs text-right">Orden</th>
                  <th className="px-4 py-2 label-xs">Estado</th>
                  {puedeEditar ? <th className="px-4 py-2 label-xs text-right">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {perfiles.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><Num>{p.codigo ?? "—"}</Num></td>
                    <td className="px-4 py-2 font-semibold">{p.nombre ?? "—"}</td>
                    <td className="px-4 py-2 max-w-[46ch] text-muted-foreground">{p.descripcion ?? "—"}</td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{p.orden ?? 0}</Num></td>
                    <td className="px-4 py-2">
                      <Badge tono={p.activo ? "exito" : "neutro"}>{p.activo ? "activo" : "inactivo"}</Badge>
                    </td>
                    {puedeEditar ? (
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variante="secundario" onClick={() => abrirPerfil(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            variante="fantasma"
                            cargando={desactivarPerfil.isPending && desactivarPerfil.variables?.id === p.id}
                            onClick={() => desactivarPerfil.mutate(p)}
                          >
                            {p.activo ? "Desactivar" : "Reactivar"}
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            titulo="Actividades"
            descripcion="Clasifican qué se hizo en cada hora registrada."
            accion={
              puedeEditar ? (
                <Button variante="primario" onClick={() => abrirActividad("nuevo")}>
                  <Plus className="h-3.5 w-3.5" />
                  Nueva actividad
                </Button>
              ) : null
            }
          />
          <div className="px-4 pt-3">
            <Aviso tono="info" titulo="Cómo influye el indicador de cobrable">
              Una actividad marcada como no cobrable fuerza el registro a no cobrable, aunque la asignación del
              colaborador sí lo sea. Es la regla más restrictiva la que manda.
            </Aviso>
          </div>
          {actividadesQ.isLoading ? (
            <Vacio mensaje="Cargando actividades…" />
          ) : actividades.length === 0 ? (
            <Vacio mensaje="No hay actividades registradas." />
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Código</th>
                  <th className="px-4 py-2 label-xs">Nombre</th>
                  <th className="px-4 py-2 label-xs">Cobrable</th>
                  <th className="px-4 py-2 label-xs">Estado</th>
                  {puedeEditar ? <th className="px-4 py-2 label-xs text-right">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {actividades.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2"><Num>{a.codigo ?? "—"}</Num></td>
                    <td className="px-4 py-2 font-semibold">{a.nombre ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Badge tono={a.cobrable ? "exito" : "neutro"}>{a.cobrable ? "cobrable" : "no cobrable"}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tono={a.activo ? "exito" : "neutro"}>{a.activo ? "activo" : "inactivo"}</Badge>
                    </td>
                    {puedeEditar ? (
                      <td className="px-4 py-2 text-right">
                        <Button variante="secundario" onClick={() => abrirActividad(a)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {perfilEdit ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-10 w-full max-w-lg rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">
                {perfilEdit === "nuevo" ? "Nuevo perfil profesional" : `Editar ${perfilEdit.codigo ?? ""}`}
              </h3>
              <Button variante="fantasma" onClick={() => setPerfilEdit(null)} aria-label="Cerrar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <Etiqueta>Código</Etiqueta>
                <input className="field num mt-1" value={perfilForm.codigo} onChange={(e) => setPerfilForm({ ...perfilForm, codigo: e.target.value })} />
              </div>
              <div>
                <Etiqueta>Orden</Etiqueta>
                <input className="field num mt-1" inputMode="numeric" value={perfilForm.orden} onChange={(e) => setPerfilForm({ ...perfilForm, orden: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Etiqueta>Nombre</Etiqueta>
                <input className="field mt-1" value={perfilForm.nombre} onChange={(e) => setPerfilForm({ ...perfilForm, nombre: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Etiqueta>Descripción</Etiqueta>
                <textarea className="field mt-1 min-h-[80px]" value={perfilForm.descripcion} onChange={(e) => setPerfilForm({ ...perfilForm, descripcion: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={perfilForm.activo} onChange={(e) => setPerfilForm({ ...perfilForm, activo: e.target.checked })} />
                  Perfil activo
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setPerfilEdit(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={perfilForm.codigo.trim() === "" || perfilForm.nombre.trim() === ""}
                cargando={guardarPerfil.isPending}
                onClick={() => guardarPerfil.mutate()}
              >
                Guardar perfil
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {actEdit ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-10 w-full max-w-lg rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">
                {actEdit === "nuevo" ? "Nueva actividad" : `Editar ${actEdit.codigo ?? ""}`}
              </h3>
              <Button variante="fantasma" onClick={() => setActEdit(null)} aria-label="Cerrar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <Etiqueta>Código</Etiqueta>
                <input className="field num mt-1" value={actForm.codigo} onChange={(e) => setActForm({ ...actForm, codigo: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Etiqueta>Nombre</Etiqueta>
                <input className="field mt-1" value={actForm.nombre} onChange={(e) => setActForm({ ...actForm, nombre: e.target.value })} />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={actForm.cobrable} onChange={(e) => setActForm({ ...actForm, cobrable: e.target.checked })} />
                  Actividad cobrable
                </label>
                <p className="text-[12px] text-muted-foreground">
                  Si la desmarcas, toda hora registrada con esta actividad queda como no cobrable aunque la
                  asignación del colaborador sea cobrable.
                </p>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={actForm.activo} onChange={(e) => setActForm({ ...actForm, activo: e.target.checked })} />
                  Actividad activa
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setActEdit(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={actForm.codigo.trim() === "" || actForm.nombre.trim() === ""}
                cargando={guardarActividad.isPending}
                onClick={() => guardarActividad.mutate()}
              >
                Guardar actividad
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
