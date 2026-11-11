import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Aviso, Badge, Button, Card, CardHeader, Etiqueta, Num, Vacio } from "@/components/ui-kit";
import { useSesion } from "@/context/session";
import { mensajeDeError, sustenta, sustentaConfigurado } from "@/integrations/sustenta/client";
import type { Rol } from "@/integrations/sustenta/types";
import { ROLES } from "@/lib/nav";
import { n } from "@/lib/formato";

export const Route = createFileRoute("/admin/colaboradores")({
  head: () => ({
    meta: [
      { title: "Colaboradores — Sustenta" },
      {
        name: "description",
        content: "Alta y mantenimiento de colaboradores: perfil profesional, rol de sistema, jornada y jefatura.",
      },
      { property: "og:title", content: "Colaboradores — Sustenta" },
      { property: "og:description", content: "Perfil profesional, rol de sistema, jornada y jefatura." },
    ],
  }),
  component: Colaboradores,
});

interface ColaboradorVista {
  id: string;
  documento: string | null;
  nombres: string | null;
  apellidos: string | null;
  email: string | null;
  rol: string | null;
  jefe_id: string | null;
  jefe: string | null;
  jornada_horas: number | null;
  activo: boolean | null;
  perfil_id: string | null;
  perfil: string | null;
  perfil_codigo: string | null;
  asignaciones_vigentes: number | null;
}

interface Perfil {
  id: string;
  codigo: string | null;
  nombre: string | null;
  activo: boolean | null;
  orden: number | null;
}

interface CredencialesNuevas {
  colaborador_id?: string;
  email?: string;
  password_inicial?: string;
}

const FORM_VACIO = {
  documento: "",
  nombres: "",
  apellidos: "",
  email: "",
  rol: "colaborador" as Rol,
  perfil_id: "",
  jornada_horas: "8",
  jefe_id: "",
  activo: true,
};

function Colaboradores() {
  const qc = useQueryClient();
  const { rol: rolSesion } = useSesion();
  const [editando, setEditando] = useState<ColaboradorVista | "nuevo" | null>(null);
  const [form, setForm] = useState({ ...FORM_VACIO });
  const [error, setError] = useState<string | null>(null);
  const [credenciales, setCredenciales] = useState<CredencialesNuevas | null>(null);

  const puedeEditar = rolSesion === "administracion";

  const colaboradoresQ = useQuery({
    queryKey: ["colaboradores-vista"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_v_colaborador").select("*").order("apellidos");
      if (err) throw err;
      return (data ?? []) as ColaboradorVista[];
    },
  });

  const perfilesQ = useQuery({
    queryKey: ["perfiles"],
    enabled: sustentaConfigurado,
    queryFn: async () => {
      const { data, error: err } = await sustenta.from("hr_perfil_profesional").select("*").order("orden");
      if (err) throw err;
      return (data ?? []) as Perfil[];
    },
  });

  const colaboradores = useMemo(() => colaboradoresQ.data ?? [], [colaboradoresQ.data]);
  const perfiles = perfilesQ.data ?? [];
  const jefes = colaboradores.filter((c) => (c.rol === "jefatura" || c.rol === "administracion") && c.activo);

  const crear = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await sustenta.rpc("hr_crear_colaborador", {
        p_documento: form.documento.trim(),
        p_nombres: form.nombres.trim(),
        p_apellidos: form.apellidos.trim(),
        p_email: form.email.trim(),
        p_rol: form.rol,
        p_perfil_id: form.perfil_id || null,
        p_jornada: Number(form.jornada_horas),
        p_jefe_id: form.jefe_id || null,
      });
      if (err) throw err;
      return (Array.isArray(data) ? data[0] : data) as CredencialesNuevas;
    },
    onSuccess: (datos) => {
      setError(null);
      setEditando(null);
      setCredenciales(datos ?? null);
      toast.success("Colaborador creado");
      void qc.invalidateQueries({ queryKey: ["colaboradores-vista"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  const actualizar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await sustenta
        .from("hr_colaborador")
        .update({
          perfil_id: form.perfil_id || null,
          rol: form.rol,
          jornada_horas: Number(form.jornada_horas),
          jefe_id: form.jefe_id || null,
          activo: form.activo,
        })
        .eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setEditando(null);
      toast.success("Colaborador actualizado");
      void qc.invalidateQueries({ queryKey: ["colaboradores-vista"] });
    },
    onError: (e) => {
      const m = mensajeDeError(e);
      setError(m);
      toast.error(m);
    },
  });

  function abrir(c: ColaboradorVista | "nuevo") {
    setError(null);
    setEditando(c);
    if (c === "nuevo") {
      setForm({ ...FORM_VACIO });
    } else {
      setForm({
        documento: c.documento ?? "",
        nombres: c.nombres ?? "",
        apellidos: c.apellidos ?? "",
        email: c.email ?? "",
        rol: (c.rol as Rol) ?? "colaborador",
        perfil_id: c.perfil_id ?? "",
        jornada_horas: c.jornada_horas == null ? "8" : String(Number(c.jornada_horas)),
        jefe_id: c.jefe_id ?? "",
        activo: c.activo !== false,
      });
    }
  }

  const esNuevo = editando === "nuevo";
  const formValido = esNuevo
    ? form.documento.trim().length > 0 &&
      form.nombres.trim().length > 0 &&
      form.apellidos.trim().length > 0 &&
      /.+@.+\..+/.test(form.email.trim()) &&
      Number(form.jornada_horas) > 0
    : Number(form.jornada_horas) > 0;

  return (
    <AppShell>
      <PageHeader
        titulo="Colaboradores"
        descripcion="Quién forma parte de la planilla del prestador, con su perfil, jornada y jefatura."
        acciones={[{ label: "Colaboradores", contador: colaboradores.length }]}
      />

      <div className="mb-4 flex justify-end">
        {puedeEditar ? (
          <Button variante="primario" onClick={() => abrir("nuevo")}>
            <Plus className="h-3.5 w-3.5" />
            Nuevo colaborador
          </Button>
        ) : null}
      </div>

      {colaboradoresQ.error ? (
        <div className="mb-4">
          <Aviso tono="alerta" titulo="La base de datos respondió">{mensajeDeError(colaboradoresQ.error)}</Aviso>
        </div>
      ) : null}

      <Card>
        <CardHeader titulo="Planilla del prestador" descripcion="Los datos alimentan capacidad, costos y el expediente de defensa." />
        {colaboradoresQ.isLoading ? (
          <Vacio mensaje="Cargando colaboradores…" />
        ) : colaboradores.length === 0 ? (
          <Vacio mensaje="No hay colaboradores visibles para tu perfil." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-2 label-xs">Colaborador</th>
                  <th className="px-4 py-2 label-xs">Documento</th>
                  <th className="px-4 py-2 label-xs">Correo</th>
                  <th className="px-4 py-2 label-xs">Perfil profesional</th>
                  <th className="px-4 py-2 label-xs">Rol de sistema</th>
                  <th className="px-4 py-2 label-xs">Jefe</th>
                  <th className="px-4 py-2 label-xs text-right">Jornada</th>
                  <th className="px-4 py-2 label-xs text-right">Asignaciones</th>
                  <th className="px-4 py-2 label-xs">Estado</th>
                  {puedeEditar ? <th className="px-4 py-2 label-xs text-right">Acción</th> : null}
                </tr>
              </thead>
              <tbody>
                {colaboradores.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-semibold">{`${c.nombres ?? ""} ${c.apellidos ?? ""}`.trim() || "—"}</td>
                    <td className="px-4 py-2"><Num>{c.documento ?? "—"}</Num></td>
                    <td className="px-4 py-2"><Num className="text-[12px]">{c.email ?? "—"}</Num></td>
                    <td className="px-4 py-2">{c.perfil ?? "Sin perfil"}</td>
                    <td className="px-4 py-2">{c.rol ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.jefe ?? "—"}</td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(Number(c.jornada_horas ?? 0))} h</Num></td>
                    <td className="px-4 py-2 text-right"><Num className="tabular-nums">{n(Number(c.asignaciones_vigentes ?? 0), 0)}</Num></td>
                    <td className="px-4 py-2">
                      <Badge tono={c.activo ? "exito" : "neutro"}>{c.activo ? "activo" : "inactivo"}</Badge>
                    </td>
                    {puedeEditar ? (
                      <td className="px-4 py-2 text-right">
                        <Button variante="secundario" onClick={() => abrir(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editando ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4">
          <div className="mt-8 w-full max-w-2xl rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">
                {esNuevo ? "Nuevo colaborador" : `Editar ${form.nombres} ${form.apellidos}`}
              </h3>
              <Button variante="fantasma" onClick={() => setEditando(null)} aria-label="Cerrar">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div>
                <Etiqueta>Documento</Etiqueta>
                <input
                  className="field num mt-1"
                  value={form.documento}
                  disabled={!esNuevo}
                  onChange={(e) => setForm({ ...form, documento: e.target.value })}
                />
              </div>
              <div>
                <Etiqueta>Correo</Etiqueta>
                <input
                  className="field mt-1"
                  type="email"
                  value={form.email}
                  disabled={!esNuevo}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Etiqueta>Nombres</Etiqueta>
                <input
                  className="field mt-1"
                  value={form.nombres}
                  disabled={!esNuevo}
                  onChange={(e) => setForm({ ...form, nombres: e.target.value })}
                />
              </div>
              <div>
                <Etiqueta>Apellidos</Etiqueta>
                <input
                  className="field mt-1"
                  value={form.apellidos}
                  disabled={!esNuevo}
                  onChange={(e) => setForm({ ...form, apellidos: e.target.value })}
                />
              </div>
              <div>
                <Etiqueta>Perfil profesional</Etiqueta>
                <select
                  className="field mt-1"
                  value={form.perfil_id}
                  onChange={(e) => setForm({ ...form, perfil_id: e.target.value })}
                >
                  <option value="">Sin perfil</option>
                  {perfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre ?? p.codigo}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Etiqueta>Rol de sistema</Etiqueta>
                <select
                  className="field mt-1"
                  value={form.rol}
                  onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}
                >
                  {ROLES.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta} — {r.alcance}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Etiqueta>Jornada diaria (horas)</Etiqueta>
                <input
                  className="field num mt-1"
                  inputMode="decimal"
                  value={form.jornada_horas}
                  onChange={(e) => setForm({ ...form, jornada_horas: e.target.value })}
                />
              </div>
              <div>
                <Etiqueta>Jefe</Etiqueta>
                <select
                  className="field mt-1"
                  value={form.jefe_id}
                  onChange={(e) => setForm({ ...form, jefe_id: e.target.value })}
                >
                  <option value="">Sin jefe asignado</option>
                  {jefes.map((j) => (
                    <option key={j.id} value={j.id}>
                      {`${j.nombres ?? ""} ${j.apellidos ?? ""}`.trim()}
                    </option>
                  ))}
                </select>
              </div>
              {!esNuevo ? (
                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                    />
                    Colaborador activo
                  </label>
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Aviso tono="info" titulo="Se crea también su usuario de acceso">
                    Al guardar, la base genera la cuenta y devuelve una contraseña inicial. El colaborador puede
                    entrar de inmediato a registrar sus horas.
                  </Aviso>
                </div>
              )}
              {error ? (
                <div className="sm:col-span-2">
                  <Aviso tono="alerta" titulo="La base de datos respondió">{error}</Aviso>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variante="secundario" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={!formValido}
                cargando={crear.isPending || actualizar.isPending}
                onClick={() => (esNuevo ? crear.mutate() : actualizar.mutate((editando as ColaboradorVista).id))}
              >
                {esNuevo ? "Crear colaborador" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {credenciales ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4">
          <div className="w-full max-w-lg rounded-[8px] border border-border bg-surface shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <KeyRound className="h-4 w-4 text-success" />
              <h3 className="text-sm font-semibold">Usuario creado</h3>
            </div>
            <div className="space-y-3 px-4 py-4 text-[13px]">
              <p>
                Puede iniciar sesión con <Num className="font-semibold">{credenciales.email ?? "—"}</Num> y la
                contraseña inicial <Num className="font-semibold">{credenciales.password_inicial ?? "—"}</Num>.
              </p>
              <Aviso tono="alerta" titulo="Anota la contraseña ahora">
                Esta contraseña inicial solo se muestra una vez. Entrégasela al colaborador para que registre sus
                horas de inmediato.
              </Aviso>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button
                variante="secundario"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `${credenciales.email ?? ""} / ${credenciales.password_inicial ?? ""}`,
                  );
                  toast.success("Credenciales copiadas");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
              <Button variante="primario" onClick={() => setCredenciales(null)}>Entendido</Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
