# ARCA — Asistente de Archivos para Agencias

App local (Next.js) que funciona como asistente inteligente de archivos para equipos de agencias de marketing. Guarda y busca documentos con voz, texto o drag & drop. Se ejecuta embebida dentro de **arca-desktop** (Electron), en `http://127.0.0.1:3000`.

## Características

- **Orb flotante** — botón inteligente siempre accesible (vía arca-desktop)
- **Chat con IA** — guarda y busca archivos en lenguaje natural, sin depender de un LLM (reglas + metadata)
- **Voz** — Web Speech API en español, sin dependencias externas
- **Drag & drop** — arrastra archivos directamente a la ventana
- **Búsqueda** por texto sobre metadatos (fuzzy substring)
- **Datos 100% locales** — SQLite (`better-sqlite3`) en `arca-data/arca.db`, sin cuenta ni configuración previa
- **Modo equipo (opcional)** — sincroniza documentos contra un proyecto Supabase compartido por la agencia

## Requisitos previos

- Node.js 18+
- Ninguna cuenta ni API key es necesaria para uso local

## Instalación

```bash
cd arca-app
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Normalmente esta app no se abre standalone en el navegador — se lanza junto con `arca-desktop` (ver README de esa carpeta).

## Variables de entorno

Todas son opcionales; sin ninguna, la app funciona 100% local. Copia `.env.local.example` a `.env.local` si necesitas alguna:

| Variable | Descripción |
|---|---|
| `ARCA_DB_PATH` | Ruta de la base SQLite (por defecto `./arca-data/arca.db`) |
| `ARCA_ADMIN_SECRET` | Requerido para habilitar `/api/init-team` (configurar modo equipo / sync con Supabase) |
| `ARCA_TEAMS_PATH` | Ruta alternativa para `teams.json` |

## Modo equipo (Supabase, opcional)

Si una agencia activa el modo equipo (vía código de activación en `arca-panel` durante el onboarding de arca-desktop), `lib/db.ts` sincroniza los documentos contra el proyecto Supabase de esa agencia. El schema completo vive en `supabase/schema.sql` (para proyectos nuevos) y `supabase/migrations/` (para proyectos ya existentes) — incluye `client_name`, `doc_type`, `description`, `tags`, `file_url`, `file_name`, `mime_type`, `pinned`, `team_id`, `uploaded_by` (columna legacy sin uso real, nullable con default `'desktop'`), `deleted`/`updated_at` (tombstones de sync), entre otras. Este modo es completamente opcional — no es necesario para uso individual.

## Desarrollo local

```bash
npm run dev    # Servidor de desarrollo en 127.0.0.1:3000
npm run build  # Build de producción
npm run lint   # Verificar código
```
