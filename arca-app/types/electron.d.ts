// Extends React.CSSProperties with Electron-specific CSS properties
import 'react'

declare module 'react' {
  interface CSSProperties {
    /** Electron: controls which parts of a frameless window are draggable */
    WebkitAppRegion?: 'drag' | 'no-drag' | 'inherit'
  }
}
