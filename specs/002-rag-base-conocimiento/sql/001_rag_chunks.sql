-- 002 — RAG: base de conocimiento de informes IA
--
-- ⚠️ MIGRACIÓN FUTURA — NO EJECUTAR (por ahora). El índice del RAG vive en
-- Storage (archivos rag-<informe>.rag junto a los informes IA), así que no hay
-- que crear nada en la base de datos. Este script queda como migración a
-- pgvector si la base crece a cientos de informes y bajar el índice completo
-- en cada búsqueda deje de ser imperceptible (ver plan.md, "Riesgos").
--
-- Ejecutar en el SQL editor del dashboard de Supabase (proyecto gjgezgdnpecyffjpxdep).
--
-- ⚠️ ANTES DE EJECUTAR: ajusta la dimensión de vector(1024) al modelo real de
-- embeddings del MaaS de Huawei (config MAAS_EMBEDDING_DIMS; p. ej. bge-m3 = 1024).
-- La dimensión se fija al crear la columna; si cambia después, hay que recrear
-- la tabla (la base es re-generable con rag-backfill.mjs).
--
-- Si /rest/v1/rag_chunks diera 404 tras ejecutar esto, el esquema `horas` no
-- está expuesto en PostgREST: recrea la tabla en `public` cambiando el esquema
-- en los nombres de tabla y función (y el RPC se llama igual).

-- 1. Extensión pgvector (si ya está habilitada en el dashboard, no hace nada).
create extension if not exists vector;

-- 2. Tabla de fragmentos indexados.
create table if not exists horas.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,                    -- nombre del archivo del informe (html)
  tipo text not null default 'informe',    -- por ahora solo 'informe'
  colaborador text,
  fecha date,
  texto text not null,                      -- el fragmento indexado
  embedding vector(1024) not null,          -- ⚠️ AJUSTAR a la dimensión del modelo
  creado_at timestamptz not null default now()
);

alter table horas.rag_chunks enable row level security;

-- 3. RLS: solo usuarios autenticados leen y escriben (las server fns actúan
--    con el access_token del usuario logueado).
drop policy if exists "rag_chunks_lectura_autenticados" on horas.rag_chunks;
create policy "rag_chunks_lectura_autenticados"
  on horas.rag_chunks for select
  to authenticated
  using (true);

drop policy if exists "rag_chunks_insert_autenticados" on horas.rag_chunks;
create policy "rag_chunks_insert_autenticados"
  on horas.rag_chunks for insert
  to authenticated
  with check (true);

-- 4. RPC de búsqueda por similitud coseno (security invoker: RLS aplica con
--    el token de quien llama).
create or replace function horas.match_rag_chunks(
  query_embedding vector(1024),             -- ⚠️ misma dimensión que la tabla
  match_count int default 8
)
returns table (
  id uuid,
  fuente text,
  tipo text,
  colaborador text,
  fecha date,
  texto text,
  similitud float
)
language sql
stable
security invoker
as $$
  select id, fuente, tipo, colaborador, fecha, texto,
         1 - (embedding <=> query_embedding) as similitud
  from horas.rag_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function horas.match_rag_chunks(vector, int) to authenticated;

-- Verificación rápida (con una sesión autenticada desde la app):
--   select count(*) from horas.rag_chunks;
--   select * from horas.match_rag_chunks((select embedding from horas.rag_chunks limit 1), 3);
