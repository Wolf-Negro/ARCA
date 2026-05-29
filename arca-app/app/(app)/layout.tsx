import { ArcaProvider } from '../ArcaProvider'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', background: 'transparent' }}>
      <ArcaProvider>{children}</ArcaProvider>
    </div>
  )
}
