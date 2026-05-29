# ARCA — Asistente de Archivos para Agencias

PWA instalable que funciona como asistente inteligente de archivos para equipos de agencias de marketing. Guarda y busca documentos con voz, texto o drag & drop.

## Características

- **Orb flotante** — botón inteligente siempre accesible
- **Chat con IA** — guarda y busca archivos en lenguaje natural
- **Voz** — Web Speech API en español, sin dependencias externas
- **Drag & drop** — arrastra archivos directamente a la ventana
- **Búsqueda semántica** — embeddings con OpenAI + pgvector en Supabase
- **PWA instalable** — funciona como app nativa en cualquier dispositivo

## Requisitos previos

- Node.js 18+
- Proyecto de Supabase existente con el schema de `whatsapp-doc-bot`
- API Key de OpenAI

## Instalación

```bash
cd arca-app
npm install
cp .env.local.example .env.local
# Edita .env.local con tus credenciales
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

## Variables de entorno

| Variable | Descripción |
|---|---|
| `OPENAI_API_KEY` | API Key de OpenAI (gpt-4o-mini + embeddings) |
| `SUPABASE_URL` | URL de tu proyecto Supabase |
| `SUPABASE_KEY` | Anon public key de Supabase |

## Estructura de la base de datos (Supabase)

El proyecto reutiliza el schema existente del bot de WhatsApp:

```sql
-- Tabla principal
create table documents (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  uploaded_by text,
  client_name text,
  doc_type text not null,
  description text,
  tags text[],
  file_url text,
  file_name text not null,
  mime_type text,
  embedding vector(1536),
  raw_content text
);

-- Función de búsqueda semántica (ya debe existir)
create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  id uuid, created_at timestamptz, uploaded_by text,
  client_name text, doc_type text, description text,
  tags text[], file_url text, file_name text,
  mime_type text, similarity float
)
language sql stable as $$
  select id, created_at, uploaded_by, client_name, doc_type,
         description, tags, file_url, file_name, mime_type,
         1 - (embedding <=> query_embedding) as similarity
  from documents
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;
```

### Bucket de Storage

Crea un bucket llamado `documents` en Supabase Storage con política de lectura pública:

```sql
-- Permitir uploads desde la app
create policy "Upload documents" on storage.objects
  for insert with check (bucket_id = 'documents');

-- Permitir lectura pública
create policy "Public read" on storage.objects
  for select using (bucket_id = 'documents');
```

## Deploy en Vercel

### 1. Instala Vercel CLI

```bash
npm i -g vercel
```

### 2. Deploy

```bash
cd arca-app
vercel
```

Sigue las instrucciones. Para producción:

```bash
vercel --prod
```

### 3. Variables de entorno en Vercel

En el dashboard de Vercel → tu proyecto → Settings → Environment Variables, agrega:
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`

O usa la CLI:

```bash
vercel env add OPENAI_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_KEY
```

## Instalar como PWA

### iPhone / iPad (Safari)

1. Abre la URL de tu app en Safari
2. Toca el botón de compartir (cuadrado con flecha hacia arriba)
3. Desplázate y toca **"Agregar a pantalla de inicio"**
4. Toca **"Agregar"**
5. La app aparecerá en tu pantalla de inicio como una app nativa

### Android (Chrome)

1. Abre la URL en Chrome
2. Toca el menú (tres puntos) → **"Instalar app"** o **"Agregar a pantalla de inicio"**
3. Confirma la instalación
4. La app aparecerá en tu cajón de aplicaciones

### Windows / Mac (Chrome o Edge)

1. Abre la URL en Chrome o Edge
2. Busca el ícono de instalación en la barra de direcciones (⊕ o pantalla con flecha)
3. Haz clic en **"Instalar"**
4. La app se abrirá como ventana independiente

## Comandos del chat

| Comando | Efecto |
|---|---|
| Pegar un link de Google Docs, Sheets, etc. | Analiza y propone guardar |
| Arrastrar un archivo | Extrae texto y propone metadatos |
| "busca el contrato de [cliente]" | Búsqueda semántica |
| "listar todo" | Últimos 10 documentos |
| "documentos de [cliente]" | Filtrar por cliente |
| "ayuda" | Muestra comandos disponibles |
| "sí / dale / ok" | Confirmar guardar documento pendiente |

## Desarrollo local

```bash
npm run dev    # Servidor de desarrollo en :3000
npm run build  # Build de producción
npm run lint   # Verificar código
```

El Service Worker (PWA) solo se activa en producción (`NODE_ENV=production`).
En desarrollo, la app funciona normalmente sin SW.
