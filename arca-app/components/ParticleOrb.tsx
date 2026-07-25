'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export type OrbState = 'idle' | 'listening' | 'processing' | 'responding' | 'success'

interface Particle {
  x: number
  y: number
  angle: number
  speed: number
  radius: number
  phase: number
}

// CSS display size of the canvas
const CSS = 120
const CTR = CSS / 2  // 60

// Per-state configuration (all measurements in CSS pixels)
// orbit radius increased by 20% for idle (40 → 48)
const CFG = {
  idle:       { rgb: [123, 116, 224] as [number,number,number], orbit: 48, spd: 1.0, connAlpha: 0.15 },
  listening:  { rgb: [96,  232, 160] as [number,number,number], orbit: 26, spd: 2.5, connAlpha: 0.30 },
  processing: { rgb: [240, 192,  96] as [number,number,number], orbit: 32, spd: 3.0, connAlpha: 0.25 },
  responding: { rgb: [83,   74, 183] as [number,number,number], orbit: 38, spd: 1.8, connAlpha: 0.20 },
  success:    { rgb: [29,  158, 117] as [number,number,number], orbit: 50, spd: 3.0, connAlpha: 0.30 },
}

// Ambient drop-shadow color per state (R, G, B)
const GLOW: Record<OrbState, [number, number, number]> = {
  idle:       [123, 116, 224],
  listening:  [96,  232, 160],
  processing: [240, 192,  96],
  responding: [120, 100, 220],
  success:    [29,  158, 117],
}

const N = 85
const CONN_DIST    = 38   // px — max distance to draw a connection
const REPEL_RADIUS = 36   // px — mouse repulsion field
const REPEL_FORCE  = 1.8  // px — max repulsion displacement

// Minimum speed multiplier so particles never fully stop in any state
const MIN_SPD = 0.5

// Warm amber tint for responding state
const AMBER: [number, number, number] = [255, 180, 80]

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

// Blend two RGB triplets by weight w (0 = fully a, 1 = fully b)
function blendRgb(
  a: [number, number, number],
  b: [number, number, number],
  w: number,
): [number, number, number] {
  return [
    lerp(a[0], b[0], w),
    lerp(a[1], b[1], w),
    lerp(a[2], b[2], w),
  ]
}

export interface ParticleOrbProps {
  state:        OrbState
  audioLevel?:  number                       // 0–100, drives listening jitter
  themeColor?:  [number, number, number]     // overrides idle RGB (theme system)
  onClick:      () => void
  onLongPress?: () => void
}

export function ParticleOrb({
  state,
  audioLevel = 0,
  themeColor,
  onClick,
  onLongPress,
}: ParticleOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const mousePos  = useRef<{ x: number; y: number } | null>(null)
  const rafId     = useRef(0)
  const frameN    = useRef(0)

  // Mutable state refs so the animation loop doesn't need re-creates
  const stateRef = useRef(state)
  const audioRef = useRef(audioLevel)
  const themeRef = useRef(themeColor)

  // Interpolated rendering state
  const curRgb   = useRef<[number, number, number]>([...CFG.idle.rgb])
  const curOrbit = useRef(CFG.idle.orbit)

  // Stable ref so handleMouseDown closure always calls current onClick/onLongPress
  const onClickRef     = useRef(onClick)
  const onLongPressRef = useRef(onLongPress)
  useEffect(() => { onClickRef.current = onClick },         [onClick])
  useEffect(() => { onLongPressRef.current = onLongPress }, [onLongPress])

  useEffect(() => { stateRef.current = state },      [state])
  useEffect(() => { audioRef.current = audioLevel }, [audioLevel])
  useEffect(() => { themeRef.current = themeColor }, [themeColor])

  // ── Ambient glow: update canvas filter when state changes ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const [r, g, b] = GLOW[state]
    canvas.style.filter = `drop-shadow(0 8px 24px rgba(${r},${g},${b},0.35))`
  }, [state])

  // ── Init particles once ────────────────────────────────────────────────────
  useEffect(() => {
    particles.current = Array.from({ length: N }, (_, i) => {
      const angle = (i / N) * Math.PI * 2
      const r     = CFG.idle.orbit * (0.4 + Math.random() * 0.6)
      return {
        x:      CTR + Math.cos(angle) * r,
        y:      CTR + Math.sin(angle) * r,
        angle,
        speed:  0.004 + Math.random() * 0.007,
        radius: 1.0  + Math.random() * 1.2,
        phase:  Math.random() * Math.PI * 2,
      }
    })
  }, [])

  // ── Canvas setup + animation loop ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const dpr  = Math.min(window.devicePixelRatio || 1, 2)
    const SIZE = CSS * dpr
    canvas.width  = SIZE
    canvas.height = SIZE
    ctx.scale(dpr, dpr)

    function tick() {
      rafId.current = requestAnimationFrame(tick)
      frameN.current++
      const f     = frameN.current
      const s     = stateRef.current
      const cfg   = CFG[s]
      const lvl   = audioRef.current
      const theme = themeRef.current
      const now   = Date.now()

      ctx.clearRect(0, 0, CSS, CSS)

      // Target RGB — idle uses theme override if provided
      const targetRgb: [number, number, number] =
        s === 'idle' && theme ? theme : cfg.rgb

      curRgb.current = curRgb.current.map(
        (v, i) => lerp(v, targetRgb[i], 0.05)
      ) as [number, number, number]
      const [cr, cg, cb] = curRgb.current

      const audioBoost = s === 'listening' ? (lvl / 100) * 11 : 0
      curOrbit.current = lerp(curOrbit.current, cfg.orbit + audioBoost, 0.07)
      const orbit = curOrbit.current

      // ── Idle breathing pulse: ±4% over 3 s period ─────────────────────────
      const breathScale =
        s === 'idle'
          ? 1 + 0.04 * Math.sin((now / 3000) * Math.PI * 2)
          : 1
      const breathOrbit = orbit * breathScale

      const ps    = particles.current
      const mouse = mousePos.current

      // Effective speed — never below MIN_SPD to keep particles alive
      const effectiveSpd = Math.max(cfg.spd, MIN_SPD)

      // ── Update particle positions ──────────────────────────────────────────
      for (const p of ps) {
        if (s === 'idle') {
          p.angle += p.speed * effectiveSpd
          // Use breathOrbit so idle radius pulses with the breathing effect
          const r  = breathOrbit * (0.45 + 0.55 * Math.sin(f * 0.009 + p.phase))
          const tx = CTR + Math.cos(p.angle) * r
          const ty = CTR + Math.sin(p.angle) * r
          p.x = lerp(p.x, tx, 0.025) + (Math.random() - 0.5) * 0.25
          p.y = lerp(p.y, ty, 0.025) + (Math.random() - 0.5) * 0.25

        } else if (s === 'listening') {
          p.angle += p.speed * effectiveSpd
          const jitter = (lvl / 100) * 9
          const r  = orbit * (0.55 + Math.random() * 0.45)
          const tx = CTR + Math.cos(p.angle) * r + (Math.random() - 0.5) * jitter
          const ty = CTR + Math.sin(p.angle) * r + (Math.random() - 0.5) * jitter
          p.x = lerp(p.x, tx, 0.07)
          p.y = lerp(p.y, ty, 0.07)

        } else if (s === 'processing') {
          // ~2× faster angular velocity than base config
          p.angle += p.speed * effectiveSpd * 2
          const r  = orbit * (0.8 + 0.2 * Math.sin(f * 0.03 + p.phase))
          const tx = CTR + Math.cos(p.angle) * r
          const ty = CTR + Math.sin(p.angle) * r
          p.x = lerp(p.x, tx, 0.04)
          p.y = lerp(p.y, ty, 0.04)

        } else if (s === 'responding') {
          p.angle += p.speed * effectiveSpd
          // Wave function: pulse amplitude based on distance from center + time
          const dist = Math.sqrt((p.x - CTR) ** 2 + (p.y - CTR) ** 2)
          const wave = Math.sin(dist * 0.18 - now * 0.003 + p.phase) * 8
          const tx = CTR + Math.cos(p.angle) * (orbit + wave)
          const ty = CTR + Math.sin(p.angle) * (orbit + wave)
          p.x = lerp(p.x, tx, 0.05)
          p.y = lerp(p.y, ty, 0.05)

        } else {
          // success — explode outward
          p.angle += p.speed * effectiveSpd
          const tx = CTR + Math.cos(p.angle) * orbit
          const ty = CTR + Math.sin(p.angle) * orbit
          p.x = lerp(p.x, tx, 0.10)
          p.y = lerp(p.y, ty, 0.10)
        }

        // Mouse repulsion
        if (mouse) {
          const dx   = p.x - mouse.x
          const dy   = p.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < REPEL_RADIUS && dist > 0) {
            const force = ((REPEL_RADIUS - dist) / REPEL_RADIUS) * REPEL_FORCE
            p.x += (dx / dist) * force
            p.y += (dy / dist) * force
          }
        }
      }

      // ── Draw connections ───────────────────────────────────────────────────
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x
          const dy = ps[i].y - ps[j].y
          const d  = Math.sqrt(dx * dx + dy * dy)
          if (d < CONN_DIST) {
            const alpha = (1 - d / CONN_DIST) * cfg.connAlpha
            ctx.beginPath()
            ctx.strokeStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha})`
            ctx.lineWidth = 0.4
            ctx.moveTo(ps[i].x, ps[i].y)
            ctx.lineTo(ps[j].x, ps[j].y)
            ctx.stroke()
          }
        }
      }

      // ── Draw particles ─────────────────────────────────────────────────────
      for (const p of ps) {
        // Processing: brighter (higher min opacity)
        const baseAlpha = s === 'processing' ? 0.72 : 0.55
        const randAlpha = s === 'processing' ? 0.28 : 0.45
        const a = baseAlpha + Math.random() * randAlpha

        // Responding: blend in warm amber tint
        let drawR = cr, drawG = cg, drawB = cb
        if (s === 'responding') {
          const tinted = blendRgb([cr, cg, cb], AMBER, 0.3)
          drawR = tinted[0]
          drawG = tinted[1]
          drawB = tinted[2]
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${drawR | 0},${drawG | 0},${drawB | 0},${a})`
        ctx.fill()
      }

      // ── Center glow ───────────────────────────────────────────────────────
      if (s === 'processing') {
        // More concentrated, larger, more opaque core glow for processing
        const glowR = orbit * 0.62
        const grad = ctx.createRadialGradient(CTR, CTR, 0, CTR, CTR, glowR)
        grad.addColorStop(0,   `rgba(${cr | 0},${cg | 0},${cb | 0},0.55)`)
        grad.addColorStop(0.4, `rgba(${cr | 0},${cg | 0},${cb | 0},0.22)`)
        grad.addColorStop(1,   `rgba(${cr | 0},${cg | 0},${cb | 0},0)`)
        ctx.beginPath()
        ctx.arc(CTR, CTR, glowR, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
      }

      // ── Listening audio ring ───────────────────────────────────────────────
      if (s === 'listening' && lvl > 4) {
        const ringR = orbit + 10 + (lvl / 100) * 8 + Math.sin(f * 0.12) * 3
        const ringA = 0.12 + (lvl / 100) * 0.28
        ctx.beginPath()
        ctx.arc(CTR, CTR, ringR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${ringA})`
        ctx.lineWidth = 1
        ctx.stroke()
      }

    }

    tick()
    return () => cancelAnimationFrame(rafId.current)
  }, [])

  // ── Event handlers ─────────────────────────────────────────────────────────

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    mousePos.current = {
      x: (e.clientX - rect.left) * (CSS / rect.width),
      y: (e.clientY - rect.top)  * (CSS / rect.height),
    }
  }
  function onMouseLeave() { mousePos.current = null }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const startX    = e.screenX
    const startY    = e.screenY
    const startTime = Date.now()
    let dragging    = false
    let longPressed = false

    // Reset delta tracker in main process
    ;(window as any).electronAPI?.moveWindow?.(0, 0)

    const longPressTimer = setTimeout(() => {
      longPressed = true
      onLongPressRef.current?.()
    }, 500)

    function onDocMouseMove(evt: MouseEvent) {
      const dx = Math.abs(evt.screenX - startX)
      const dy = Math.abs(evt.screenY - startY)
      if (dx > 5 || dy > 5) {
        if (!dragging) clearTimeout(longPressTimer)
        dragging = true
        ;(window as any).electronAPI?.moveWindow?.(evt.screenX, evt.screenY)
      }
    }

    function onDocMouseUp() {
      document.removeEventListener('mousemove', onDocMouseMove)
      document.removeEventListener('mouseup',   onDocMouseUp)
      clearTimeout(longPressTimer)
      if (dragging) {
        ;(window as any).electronAPI?.snapToEdge?.()
      } else if (!longPressed && Date.now() - startTime < 300) {
        onClickRef.current()
      }
    }

    document.addEventListener('mousemove', onDocMouseMove)
    document.addEventListener('mouseup',   onDocMouseUp)
  }

  const statusLabel: Record<OrbState, string> = {
    idle:       '',
    listening:  'Escuchando...',
    processing: 'Procesando...',
    responding: 'Respondiendo...',
    success:    '',
  }

  const isActive = state === 'listening' || state === 'processing' || state === 'responding'
  const cssScale = isActive ? 1.35 : 1

  return (
    <div
      style={{
        position:      'fixed',
        bottom:        22,
        right:         18,
        zIndex:        9997,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           4,
        pointerEvents: 'auto',
      }}
    >
      <motion.canvas
        ref={canvasRef}
        id="particle-canvas"
        style={{
          width:           CSS,
          height:          CSS,
          cursor:          'pointer',
          transformOrigin: 'bottom center',
        }}
        animate={{ scale: cssScale }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={handleMouseDown}
      />

      <AnimatePresence>
        {statusLabel[state] && (
          <motion.span
            key={statusLabel[state]}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{    opacity: 0, y: 4 }}
            transition={{ duration: 0.25 }}
            style={{
              fontSize:    11,
              fontWeight:  500,
              color:       'rgba(255,255,255,0.65)',
              letterSpacing: '0.025em',
              pointerEvents: 'none',
              userSelect:    'none',
              WebkitUserSelect: 'none',
            }}
          >
            {statusLabel[state]}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
