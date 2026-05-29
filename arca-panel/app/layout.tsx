import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ARCA Panel',
  description: 'Panel de administración ARCA',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #0a0a0f;
            color: #fff;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          input:focus { outline: none; }
          button { cursor: pointer; font-family: inherit; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
