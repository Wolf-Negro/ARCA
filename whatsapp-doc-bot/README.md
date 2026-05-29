# WhatsApp Doc Bot — Node.js v2

Bot de WhatsApp para organizar y recuperar documentos de una agencia.  
Esta versión usa **whatsapp-web.js** con autenticación por QR (sin necesidad de Meta Cloud API ni número de negocio oficial).

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 18+ |
| Mensajería | whatsapp-web.js (QR scan) |
| IA | OpenAI GPT-4o-mini + text-embedding-3-small |
| Base de datos | Supabase (PostgreSQL + pgvector) |
| Storage | Supabase Storage |
| Deploy | Railway / Render / VPS |

## Estructura del proyecto

```
whatsapp-doc-bot/
├── index.js                 ← Entry point: inicializa WhatsApp + Express
├── config.js                ← Variables de entorno con validación
├── package.json
├── .env.example
├── database_schema.sql      ← Schema SQL para Supabase (mismo del proyecto Python)
├── handlers/
│   └── messageHandler.js    ← Toda la lógica de negocio del bot
└── services/
    ├── whatsapp.js          ← Envío/recepción de mensajes y archivos
    ├── openai.js            ← GPT-4o-mini + embeddings + vision
    ├── database.js          ← Supabase: guardar, buscar, pendientes
    └── fileHandler.js       ← Extracción de contenido (PDF, DOCX, XLSX, imágenes)
```

---

## Instalación

### 1. Requisitos previos

- **Node.js 18+** — [descargar](https://nodejs.org/)
- **Google Chrome** instalado (Puppeteer lo usa por defecto, o descarga su propio Chromium)
- Proyecto en **Supabase** con el schema aplicado
- **API Key de OpenAI**

### 2. Instalar dependencias

```bash
cd whatsapp-doc-bot
npm install
```

> La primera instalación tarda unos minutos porque Puppeteer descarga Chromium (~170 MB).

### 3. Configurar variables de entorno

```bash
cp .env.example .env
# Editá .env con tus credenciales reales
```

Variables requeridas:
- `OPENAI_API_KEY` → desde [platform.openai.com](https://platform.openai.com/api-keys)
- `SUPABASE_URL` → Project Settings > API en tu proyecto Supabase
- `SUPABASE_KEY` → **service_role key** (no la anon key)

### 4. Configurar la base de datos en Supabase

1. Abrí el **SQL Editor** en el dashboard de Supabase.
2. Pegá y ejecutá el contenido de `database_schema.sql`.
3. Creá el bucket de storage: **Storage > New bucket > nombre: `documents` > marcá como Public**.

---

## Cómo escanear el QR

### Primera vez

```bash
npm start
```

1. En la consola aparece un código QR (caracteres ASCII).
2. Abrí WhatsApp en tu teléfono.
3. **Android**: Configuración → Dispositivos vinculados → Vincular dispositivo.  
   **iPhone**: Configuración → Dispositivos vinculados → Vincular dispositivo.
4. Apuntá la cámara al QR de la consola.
5. El bot muestra `🤖 Bot conectado ✅` cuando la conexión es exitosa.

### Sesiones siguientes

La sesión se guarda en `.wwebjs_auth/`. La próxima vez que ejecutes `npm start`, el bot se conecta directamente **sin pedir QR**.

```bash
npm start
# 🤖 Bot conectado ✅  (sin mostrar QR)
```

Para **cerrar sesión** y empezar con QR nuevo:
```bash
rm -rf .wwebjs_auth/
npm start
```

---

## Cómo probar el bot

Una vez conectado, enviá mensajes desde WhatsApp al número vinculado:

### Guardar un documento
```
[enviá un PDF, imagen, Word o Excel]
→ Bot: "Analicé el archivo. Aquí están los metadatos..."
→ Vos: "sí"
→ Bot: "Guardado ✅"
```

### Guardar un link
```
https://ejemplo.com/propuesta.html
→ Bot: "Analicé el link. Aquí están los metadatos..."
→ Vos: "el cliente es Martínez, el tipo es propuesta"
→ Bot: "Actualicé los metadatos... ¿Ahora sí lo guardo?"
→ Vos: "sí"
→ Bot: "Guardado ✅"
```

### Buscar documentos
```
pásame el contrato de Martínez
dame el logo de Coca Cola
el presupuesto de enero
```

### Comandos
```
listar todo
documentos de Coca Cola
ayuda
```

---

## Deploy en Railway

### 1. Preparar el proyecto

```bash
# Asegurate de tener .gitignore con:
# .env
# .wwebjs_auth/
# node_modules/
```

### 2. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app/) → New Project → Deploy from GitHub Repo.
2. Seleccioná el repositorio.

### 3. Configurar variables de entorno

En Railway > Variables, agregá las mismas del `.env.example`.

### 4. Agregar variables de Puppeteer para entorno Linux

Railway corre en Linux. Agregá estas variables adicionales:

```
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

Y en el `Dockerfile` (si usás uno) o en el build command, instalá Chromium:
```bash
apt-get install -y chromium-browser
```

Alternativa más simple: usá el [Nixpacks de Railway](https://nixpacks.com/) con:
```toml
# nixpacks.toml
[phases.setup]
nixPkgs = ["chromium"]

[variables]
PUPPETEER_EXECUTABLE_PATH = "/run/current-system/sw/bin/chromium"
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
```

### 5. Primer QR en producción

Al hacer deploy por primera vez, mirá los logs en Railway para ver el QR y escanearlo.  
La sesión queda guardada en el filesystem de Railway entre reinicios (si usás un volumen persistente).

> Para persistencia de sesión en Railway: agrega un **Volume** y configura `WWEBJS_AUTH_PATH=/data/wwebjs_auth`.

---

## Migrar a Meta Cloud API (WhatsApp Business oficial)

Si en algún momento necesitás escalar a la API oficial de Meta, estos son los cambios:

### Lo que cambia
| Aspecto | whatsapp-web.js (actual) | Meta Cloud API |
|---------|-------------------------|----------------|
| Autenticación | QR scan (número personal) | Token de acceso (número business) |
| Costo | Gratis | Pago por conversación |
| Límites | ~1000 msg/día aprox. | Según tier |
| Archivos | Buffer directo | URL de Meta (temporal) |
| Eventos | Eventos de puppeteer | Webhook HTTP POST |
| Deploy | Necesita Chrome | Solo HTTP |

### Pasos para migrar

1. **Crear cuenta en Meta Business** → agregar número de WhatsApp Business.
2. **Reemplazar `index.js`**: en lugar de un cliente whatsapp-web.js, crear un servidor Express con:
   - `GET /webhook` → verificación con `hub.challenge`
   - `POST /webhook` → recibir mensajes y responder `200 OK` inmediatamente
3. **Reemplazar `services/whatsapp.js`**: usar `axios.post` a `graph.facebook.com/v19.0/{phone_id}/messages`.
4. **`handlers/messageHandler.js`**: sin cambios (la lógica de negocio es idéntica).
5. **`services/openai.js`** y **`services/database.js`**: sin cambios.
6. **Variables nuevas**: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`.

> La versión Python del proyecto (`app.py`, `routes/webhook.py`) ya implementa esta arquitectura completa si necesitás referencia.

---

## Solución de problemas

**El QR no aparece o expira rápido:**
- Escaneá rápido, el QR expira en ~60 segundos.
- Si expiró, el proceso lo regenera automáticamente.

**Error "Session closed" o "Protocol error":**
- Eliminá `.wwebjs_auth/` y volvé a escanear.

**Error de Puppeteer en Linux/Railway:**
- Agregá `--no-sandbox` a los args (ya está configurado en `index.js`).
- Asegurate de tener `chromium` instalado en el sistema.

**La búsqueda no encuentra documentos:**
- Verificá que la función RPC `match_documents` esté creada en Supabase (está en `database_schema.sql`).
- El índice IVFFlat requiere al menos 1 documento para funcionar.

**Error "relation documents does not exist":**
- Ejecutá `database_schema.sql` completo en el SQL Editor de Supabase.

**WhatsApp desconecta el bot periódicamente:**
- Esto es normal en cuentas no-business. El `event disconnected` en `index.js` intenta reconectarse automáticamente.
- Para mayor estabilidad, considerá migrar a Meta Cloud API.

---

## Notas importantes

- Este bot usa una cuenta de WhatsApp **personal** (no business). Meta puede restringir el número si detecta automatización masiva. Úsalo responsablemente.
- La sesión `LocalAuth` guarda las credenciales de WhatsApp en `.wwebjs_auth/`. **No subas esta carpeta a git** (ya está en `.gitignore`).
- Los archivos se suben a **Supabase Storage** (no se guardan localmente). El bucket debe existir y ser público.
