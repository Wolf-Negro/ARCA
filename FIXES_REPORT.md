# ARCA — Reporte de Estabilización Pre-Piloto

Ejecutado por fases según el prompt maestro v1. Un commit por fase (`fix(fase-N): ...`),
cada uno verificado con `npm run lint` + `npm run test` en `arca-app` (y `npm run build`
donde correspondía) antes de avanzar a la siguiente.

Commits: `083a242` (fase 1) → `f5ec5ed` (fase 2) → `dca9fff` (fase 3) → `a7731a6` (fase 4)
→ `dbe7082` (fase 5) → `164593f` (fase 6).

Leyenda: ✅ hecho y verificado · ⚠️ hecho pero con verificación parcial/pendiente de algo
que este entorno no puede tocar (sesión gráfica interactiva real, o un proyecto Supabase real).

---

## Fase 1 — Pérdida de datos y feature core rota

| Punto | Estado |
|---|---|
| 1.1 `lib/paths.ts` centraliza `DB_PATH`/`UPLOADS_DIR` | ✅ |
| 1.1 `ARCA_UPLOADS_PATH` apunta a `userData` en main.js | ✅ |
| 1.1 Migración one-shot de uploads viejos (`uploads-migrated.json`) | ✅ (lógica implementada; no se pudo probar la migración real porque no hay una instalación previa con uploads en `resources/app` para migrar — el marker y el copy-si-no-existe están verificados por lectura de código) |
| 1.1 Migración de `file_url` roto en la DB | ✅ |
| 1.2 Abrir archivos locales (`open-external` acepta `file://` dentro de `UPLOADS_DIR`) | ✅ |

**Verificación fuerte**: simulé un auto-update completo de forma headless — arranqué el
server empaquetado, subí un archivo y guardé un documento, **borré por completo** la
carpeta `resources/app` (exactamente lo que hace electron-updater), instalé una copia
"v2" fresca, y confirmé que el documento y el archivo (contenido incluido) seguían
intactos porque viven en `userData`, no en `resources/app`. Este era el bug crítico
original y quedó demostrado que ya no ocurre.

---

## Fase 2 — Modo equipo funcional

| Punto | Estado |
|---|---|
| 2.1 `ARCA_ADMIN_SECRET` generado por sesión, viaja solo por IPC | ✅ |
| 2.2 `ArcaProvider` manda el header y ya no silencia errores | ✅ |
| 2.3 `team-config.json` persiste supabaseUrl/Key/teamId/anonKey | ✅ |

**Verificación fuerte**: contra el server empaquetado real, confirmé que `/api/init-team`
da 403 sin el header y pasa la autorización con el header correcto (con `ARCA_ADMIN_SECRET`
seteado). Simulé un restart del proceso con `team-config.json` preexistente y confirmé
que `getMode()` recupera modo equipo sin que nadie llame `init-team` de nuevo (probado
indirectamente: `/api/stats` intenta la ruta de Supabase — falla contra un proyecto falso
como se espera, pero confirma que sí tomó el modo equipo).

---

## Fase 3 — Aislamiento multi-tenant y hardening del panel

| Punto | Estado |
|---|---|
| 3.1 JWT por agencia en `/api/activate` (`role: authenticated`, `team_id`) | ✅ |
| 3.1 `arca-app` separa `apikey` (anon) de `Authorization` (JWT) | ✅ |
| 3.1 RLS reescrita (`team_id = auth.jwt() ->> 'team_id'`) + migración para proyectos existentes | ✅ (código y SQL listos) |
| 3.2 Rate limit en memoria en `/api/auth` y `/api/activate` | ✅ |
| 3.3 `verify-supabase` valida hostname contra `*.supabase.co` | ✅ |
| README documenta que desactivar agencia no revoca JWTs ya emitidos | ✅ |

**Verificado sin tocar Supabase real** (regla del prompt): firma/verificación de JWT
(payloads con `team_id` distintos, rechazo con secreto incorrecto), lógica del rate
limiter (permite exactamente `max` intentos y bloquea el resto), regex de hostname
(acepta `*.supabase.co`, rechaza `evil.com` y el intento de bypass `fake.supabase.co.evil.com`).

⚠️ **Pendiente de verificación manual**: la prueba real de punta a punta — activar dos
agencias de prueba, confirmar por curl contra PostgREST que el JWT de la agencia A
devuelve `[]` al filtrar filas de la agencia B — requiere aplicar
`supabase/migrations/rls_team_isolation.sql` contra un proyecto Supabase real. No lo
hice porque tocar una base de datos real está fuera de lo que este proceso puede hacer
sin permiso explícito.

---

## Fase 4 — Sync correcto

| Punto | Estado |
|---|---|
| 4.1 Tombstones (`deleted`, `updated_at` + trigger) en schema y migración nueva | ✅ |
| 4.1 Deletes en team mode → `PATCH {deleted:true}` en vez de `DELETE` | ✅ |
| 4.1 Todas las lecturas async agregan `&deleted=eq.false` | ✅ |
| 4.2 Pull incremental por watermark (`meta.last_pull`, paginado 200/página, tope 25) | ✅ |
| 4.2 Tombstone remoto borra local aunque tenga cambios sin sincronizar | ✅ |
| 4.3 `invalidateCache()` al final de `triggerBackgroundSync` si hubo push | ✅ |
| 4.3 `file_url` local nunca sale a Supabase (se manda `null`) | ✅ |
| 4.4 Borrado físico de uploads (personal y team) | ✅ |

**Verificado headless** (sin Supabase real): tabla `meta` se crea correctamente; borrado
físico en modo personal probado end-to-end (subir archivo → guardar → borrar → el
archivo desaparece del disco).

⚠️ **Pendiente de verificación manual**: el escenario multi-instancia real (crear 3 docs
en A, verlos en B, borrar 1 en B, que desaparezca en A tras el siguiente sync; doc con
archivo local en A apareciendo sin link en B) — requiere dos instalaciones reales
apuntando al mismo proyecto Supabase con la migración de tombstones aplicada.

---

## Fase 5 — Limpieza Electron y código muerto

Todo ✅, verificado por build + reconstrucción completa del instalador + prueba
funcional headless del server empaquetado tras la limpieza:

- Flujo OAuth de Google fantasma eliminado (`open-auth`, `authWin`, `preload.js → openAuth`) — sin ningún caller en el frontend, confirmado por grep.
- Restos de voz/TTS eliminados (switches de Chromium, allowlist de permisos, `askForMediaAccess`); `setPermissionRequestHandler` deniega todo explícitamente. Tray/shortcut relabeled a "Abrir panel" (ya no dicen "Activar micrófono").
- `next-pwa` quitado (dependencia, config, `sw.js`/`workbox-*.js` generados).
- `build:mac`/`build:linux` quitados de `arca-desktop/package.json`; documentado qué falta para soportarlos.
- `onboarding.html`: sin fallback a `localhost:3001`.
- Poll de portapapeles respeta visibilidad de ventana.
- `did-fail-load` compara orígenes, no strings exactos. `activate` abre onboarding si falta `arca-config.json`.

⚠️ **Pendiente de verificación manual**: el ciclo visual completo (onboarding → orb →
panel → guardar link → spotlight, sin errores de canal IPC en consola de DevTools) —
este entorno no tiene sesión gráfica interactiva para abrir la ventana de Electron
real (confirmado a lo largo de toda la sesión: lanzar el `.exe` sin
`ELECTRON_RUN_AS_NODE` no produce ningún proceso ni ventana desde este shell).

---

## Fase 6 — Dependencias vulnerables y extracción de archivos

| Punto | Estado |
|---|---|
| 6.1 `xlsx` reemplazado por build oficial de SheetJS (`cdn.sheetjs.com/xlsx-0.20.3`) | ✅ |
| 6.2 Bug de `pdf-parse` en modo debug | ⚠️ **no aplicado** — no existe en la versión realmente instalada (1.1.4; `index.js` ya es un re-export directo sin lógica de `module.parent`). No se forzó un cambio de código sin un bug real que arreglar (regla 5 del prompt). |
| 6.2 Test de regresión de extracción (PDF + XLSX) | ✅ |

**Hallazgo no listado en el prompt, encontrado al verificar esta fase**: `xlsx`,
`mammoth` y `pdf-parse` se importan solo vía `await import(...)` dinámico dentro de un
`try/catch` — el tracing de archivos de `output: standalone` de Next.js **no sigue ese
patrón**, así que los tres quedaban completamente ausentes de
`.next/standalone/node_modules`. Esto significa que **la extracción de texto de
PDF/DOCX/XLSX estaba silenciosamente rota en todo build empaquetado** desde que se
activó `output: standalone` — el `catch` en `extractFromPdf`/`extractFromDocx`/
`extractFromXlsx` devuelve `''` sin ningún error visible, así que nadie lo iba a notar
hasta que un usuario real subiera un archivo y viera la descripción vacía. Arreglado
con `experimental.outputFileTracingIncludes` en `next.config.js`.

**Verificación fuerte**: reconstruí el instalador completo y, contra el server
empaquetado real (con el Node.js bundleado, no el de Electron), hice
`POST /api/save` con un PDF real y con un XLSX real — ambos devolvieron `rawContent`
con el texto extraído correctamente. Antes del fix de `outputFileTracingIncludes`,
ambos habrían devuelto cadena vacía.

---

## Fase 7 — QA final de empaquetado

| # | Ítem del checklist | Estado |
|---|---|---|
| 1 | Instalación limpia → onboarding → modo personal → guardar link + PDF → cerrar → reabrir → docs siguen | ⚠️ Validado el mecanismo de persistencia (SQLite + uploads en userData) exhaustivamente por fuera de la GUI; el ciclo visual completo con la ventana real queda para que lo corras vos |
| 2 | "abre <pdf>" abre el archivo con el visor del sistema | ⚠️ El handler IPC (`open-external`) está corregido y su lógica de validación de path se revisó por código; abrir realmente un visor de PDF requiere GUI |
| 3 | Onboarding modo team con código real → multi-instancia → crear/borrar visible entre instancias | ⚠️ Pendiente — requiere Supabase real + la migración de tombstones aplicada |
| 4 | Simular update: instalar N, subir archivos, instalar N+1 encima → archivos siguen abriendo | ✅ **Verificado headless de punta a punta** (ver Fase 1) |
| 5 | JWT de agencia A no lee/escribe filas de agencia B vía curl a PostgREST | ⚠️ Pendiente — requiere Supabase real + la migración RLS aplicada |
| 6 | `userData/server.log` sin stack traces tras cada arranque | ⚠️ El archivo no existe todavía en tu máquina porque la última vez que abriste la app real fue antes de que se agregara este log — revisalo la próxima vez que abras ARCA |
| 7 | Warning de SmartScreen (instalador sin firma) | Confirmado como pendiente conocido, no es un bug — ver sección siguiente |

**Por qué hay tantos ⚠️ en esta fase**: este proceso corrió en un entorno sin sesión de
escritorio interactiva. Confirmado repetidamente durante la sesión: lanzar
`ARCA.exe` directamente (sin `ELECTRON_RUN_AS_NODE=1`, es decir, como app gráfica real)
no produce ningún proceso ni ventana visible desde este shell — Electron necesita un
display real para crear una `BrowserWindow`. Todo lo que SÍ se pudo verificar
exhaustivamente es la lógica de servidor/datos (vía el server standalone corriendo
headless, con y sin el Node.js real bundleado), que es donde vivían los bugs más
graves del prompt original.

---

## Pendientes conocidos (no ejecutados — solo documentados, como pidió el prompt)

- **Firma de código Windows (EV/OV) y notarización macOS**: sin certificados. Instalador
  Windows funciona sin firma (SmartScreen advierte la primera vez, "Ejecutar de todas
  formas").
- **Revocación real de JWTs de agencia**: hoy solo expiran a los 180 días; desactivar
  una agencia en el panel no invalida tokens ya emitidos.
- **Subida de archivos a Supabase Storage**: hoy la metadata se comparte entre el
  equipo, pero el archivo binario queda solo en la máquina que lo subió.
- **Rate limit distribuido**: el de `arca-panel` es en memoria, por instancia de
  función serverless de Vercel — no hay límite global real.

## Decisiones tomadas que se desvían del prompt literal (regla 5)

1. **`pdf-parse`**: no se cambió el import a `pdf-parse/lib/pdf-parse.js` porque el bug
   descrito no existe en la versión instalada. Se invirtió el tiempo en confirmar esto
   empíricamente (con PDFs reales, incluyendo el propio sample de pdf.js) en vez de
   aplicar un parche a ciegas.
2. **`outputFileTracingIncludes`**: no estaba en el prompt en absoluto — se agregó tras
   descubrir, al verificar la Fase 6, que la extracción de archivos estaba rota en todo
   build empaquetado por una razón distinta a la de xlsx/pdf-parse en sí (un problema
   de tracing de Next.js). Se consideró que dejarlo sin arreglar habría hecho inútil el
   resto de la Fase 6.
3. **`arca-panel/README.md` y `arca-desktop/README.md`**: se hicieron ediciones
   puntuales (no reescrituras completas) para que dejaran de describir features que ya
   no existen (OAuth, voz, mac/linux) — directamente relacionado con lo que cada fase
   pedía eliminar, no un refactor por cuenta propia.
