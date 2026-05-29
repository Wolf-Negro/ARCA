-- ============================================================
-- WhatsApp Doc Bot — Schema para Supabase (PostgreSQL)
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Habilitar extensión pgvector
create extension if not exists vector;

-- 2. Tabla principal de documentos
create table if not exists documents (
  id          uuid                     default gen_random_uuid() primary key,
  created_at  timestamp with time zone default now(),
  uploaded_by text                     not null,
  client_name text,
  doc_type    text,
  description text,
  tags        text[]                   default '{}',
  file_url    text,
  file_name   text,
  mime_type   text,
  embedding   vector(1536),
  raw_content text
);

-- 3. Tabla de estados temporales (confirmaciones pendientes)
create table if not exists pending_confirmations (
  id                uuid                     default gen_random_uuid() primary key,
  created_at        timestamp with time zone default now(),
  phone_number      text                     not null,
  proposed_metadata jsonb                    not null,
  file_url          text,
  file_name         text,
  mime_type         text,
  raw_content       text,
  expires_at        timestamp with time zone default (now() + interval '10 minutes')
);

-- 4. Índice para búsqueda semántica con pgvector (IVFFlat)
--    Nota: crear DESPUÉS de tener al menos algunos registros en documents
create index if not exists documents_embedding_idx
  on documents using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 5. Índices adicionales para búsquedas frecuentes
create index if not exists documents_client_name_idx
  on documents (client_name);

create index if not exists documents_doc_type_idx
  on documents (doc_type);

create index if not exists documents_created_at_idx
  on documents (created_at desc);

create index if not exists pending_phone_idx
  on pending_confirmations (phone_number);

create index if not exists pending_expires_idx
  on pending_confirmations (expires_at);

-- 6. Función RPC para búsqueda semántica (requerida por services/database.py)
create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
returns table (
  id          uuid,
  created_at  timestamp with time zone,
  uploaded_by text,
  client_name text,
  doc_type    text,
  description text,
  tags        text[],
  file_url    text,
  file_name   text,
  mime_type   text,
  similarity  float
)
language sql stable
as $$
  select
    d.id,
    d.created_at,
    d.uploaded_by,
    d.client_name,
    d.doc_type,
    d.description,
    d.tags,
    d.file_url,
    d.file_name,
    d.mime_type,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.embedding is not null
    and 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- 7. Limpieza automática de confirmaciones expiradas (cron job en Supabase o pg_cron)
-- Si tenés pg_cron habilitado en Supabase, descomentar:
-- select cron.schedule(
--   'cleanup-expired-pending',
--   '*/5 * * * *',
--   $$ delete from pending_confirmations where expires_at < now() $$
-- );

-- 8. Row Level Security (RLS) — configurar según tu modelo de acceso
-- Por defecto se deshabilita para uso con service key desde el backend.
-- En producción, considera habilitar RLS y configurar políticas apropiadas.
alter table documents disable row level security;
alter table pending_confirmations disable row level security;

-- ============================================================
-- Supabase Storage — Crear bucket para documentos
-- Ejecutar desde el dashboard de Supabase > Storage > New bucket
-- O con la API:
-- ============================================================
-- insert into storage.buckets (id, name, public)
-- values ('documents', 'documents', true);
