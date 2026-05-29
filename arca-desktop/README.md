# ARCA Desktop

Envoltorio Electron para la PWA de ARCA. Flota como una bolita morada en tu escritorio con atajos globales, tray icon y ventana transparente.

## Cómo se ve

```
┌──────────────────────────────────────────┐  ← Escritorio (transparente)
│                                          │
│                                          │
│                                          │
│                                Orb (●)   │  ← Solo el orb es visible
│                                          │     cuando el chat está cerrado
└──────────────────────────────────────────┘

Al hacer clic → ChatPanel slide-up (400×600 flotante)
```

## Prerrequisitos

1. **Node.js 18+**
2. **arca-app corriendo** en `http://localhost:3000`

## Instalación

```bash
cd arca-desktop
npm install
```

## Uso en desarrollo

### Paso 1 — Levantar arca-app (en una terminal)

```bash
cd ../arca-app
npm run dev        # queda en http://localhost:3000
```

### Paso 2 — Lanzar el Electron (en otra terminal)

```bash
cd ../arca-desktop
npm start          # equivale a: electron .
```

La ventana aparece en la **esquina inferior derecha**. 
El icono ARCA aparece en la bandeja del sistema.

## Atajos globales

| Atajo | Acción |
|---|---|
| `Ctrl+Space` | Toggle mostrar / ocultar ventana |
| `Ctrl+Shift+V` | Activar micrófono directamente |

> **Nota sobre Ctrl+Space en Windows:** Este atajo puede estar tomado por el
> selector de idioma de entrada de Windows. Si no funciona, ve a
> Configuración → Hora e idioma → Escritura → Configuración avanzada del teclado
> → Usar la barra de idioma del escritorio → Opciones de la barra de idioma
> y deshabilita el atajo de cambio de idioma.

## Tray (bandeja del sistema)

- **Clic izquierdo** → toggle mostrar/ocultar
- **Clic derecho** → menú contextual:
  - Mostrar / Ocultar ventana
  - Activar micrófono
  - Salir

Cerrar la ventana (×) la **oculta**, no la termina.  
Para salir completamente: usa el menú del tray → **Salir**.

## Comportamiento de la ventana

| Comportamiento | Descripción |
|---|---|
| Posición inicial | Esquina inferior derecha (margen 20px) |
| Drag | Arrastra desde la barra superior (24px) o el header del chat |
| Snap | Al soltar, la ventana se imanta a la esquina más cercana |
| Always-on-top | Siempre visible sobre otras apps |
| Transparente | Solo el Orb y el ChatPanel son visibles, el fondo es el escritorio |

## Build de distribución

### Windows (genera instalador NSIS)

```bash
npm run build:win
# Salida: dist/ARCA Setup x.x.x.exe
```

### macOS (genera .dmg)

```bash
npm run build:mac
# Salida: dist/ARCA-x.x.x.dmg
```

### Todas las plataformas

```bash
npm run build
```

> **Importante:** Para hacer build de distribución, primero asegúrate de tener
> `arca-app/public/icon-192.png` y `arca-app/public/icon-512.png` (ya generados).
> En Windows necesitas `electron-builder` 24+ y Visual Studio Build Tools.

## Integración con la PWA: activación de voz

El Electron inyecta una API en `window.electronAPI` disponible para el
Next.js renderer:

```typescript
// En cualquier componente de arca-app:
declare global {
  interface Window {
    electronAPI?: {
      onActivateVoice: (cb: () => void) => void
      offActivateVoice: () => void
      notifyDocSaved: () => void
    }
  }
}

// Escuchar el shortcut Ctrl+Shift+V
useEffect(() => {
  window.electronAPI?.onActivateVoice(() => {
    startListening()  // activa Web Speech API
  })
  return () => window.electronAPI?.offActivateVoice()
}, [])
```

Para conectar el shortcut al hook de voz existente, agrega este `useEffect`
en `ArcaProvider.tsx` (el componente ya tiene acceso a `startListening`).

## Estructura de archivos

```
arca-desktop/
├── main.js       ← Proceso principal: ventana, shortcuts, IPC
├── tray.js       ← System tray: icono, menú contextual
├── preload.js    ← Bridge renderer↔main: transparent bg, drag, IPC
└── package.json
```

## Troubleshooting

**La ventana no carga / se queda en blanco**  
→ Asegúrate de que `npm run dev` en `arca-app` esté corriendo y accesible en
`http://localhost:3000`. La app intenta reconectarse cada 2s por 60s.

**El fondo no es transparente**  
→ En Windows 7/8, la transparencia de ventanas puede no funcionar. Usa
Windows 10/11. En Linux, necesitas un compositor (picom, compton, etc.).

**Ctrl+Space no funciona**  
→ Ver nota arriba sobre el selector de idioma de Windows.

**El ícono del tray aparece en negro o vacío**  
→ Asegúrate de que `../arca-app/public/icon-192.png` existe.
Puedes regenerarlo con: `node ../arca-app/scripts/generate-icons.js`
