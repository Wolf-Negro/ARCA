'use client'

import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface OrbProps {
  isOpen:       boolean
  isListening:  boolean
  isProcessing: boolean
  hasNewDoc:    boolean   // kept in API but unused visually (minimal design)
  onClick:      () => void
  onLongPress:  () => void
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LightningIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        fill="white"
        stroke="white"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ProcessingDots() {
  return (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'rgba(255,255,255,0.85)',
            display: 'block',
          }}
          animate={{ y: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 10,
            repeat: Infinity,
            delay: i * 0.14,
          }}
        />
      ))}
    </span>
  )
}

/** Conic-gradient ring that spins — drawn via mask so center stays clear */
function ProcessingRing() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
      style={{
        position: 'absolute',
        inset: -8,                    // 8px larger than the 56px orb = 72px total
        borderRadius: '50%',
        background: 'conic-gradient(from 0deg, transparent 55%, #6C63E0 85%, #534AB7 100%)',
        WebkitMaskImage: 'radial-gradient(circle, transparent 27px, black 27px)',
        maskImage:        'radial-gradient(circle, transparent 27px, black 27px)',
        pointerEvents: 'none',
      }}
    />
  )
}

/** Concentric rings that expand & fade — listening state */
function ListeningRings() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            delay: i * 0.55,
            ease: 'easeOut',
          }}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'rgba(226, 75, 74, 0.28)',
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  )
}

// ── Main Orb ──────────────────────────────────────────────────────────────────

export function Orb({ isListening, isProcessing, onClick, onLongPress }: OrbProps) {
  const pressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)

  function onPointerDown() {
    didLongPress.current = false
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true
      onLongPress()
    }, 500)
  }

  function onPointerUp() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    if (!didLongPress.current) onClick()
  }

  function onPointerLeave() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  // ── Colour transitions ──
  const bgColor   = isListening ? 'rgba(226,75,74,0.88)'    : 'rgba(83,74,183,0.88)'
  const glowColor = isListening ? 'rgba(226,75,74,0.45)'    : 'rgba(83,74,183,0.45)'
  const ringColor = isListening ? 'rgba(226,75,74,0.30)'    : 'rgba(83,74,183,0.30)'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <motion.button
        aria-label="Abrir ARCA"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.9 }}
        // Idle breathing vs listening expansion
        animate={{ scale: isListening ? 1.14 : 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        style={{
          position: 'relative',
          width: 56,
          height: 56,
          borderRadius: '50%',
          backgroundColor: bgColor,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: [
            `0 0 0 1px ${ringColor}`,
            `0 8px 32px ${glowColor}`,
            '0 2px 8px rgba(0,0,0,0.35)',
          ].join(', '),
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          outline: 'none',
          padding: 0,
          // Smooth colour transitions via CSS
          transition: 'background-color 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
          // Opt out of Electron window drag for this element
          WebkitAppRegion: 'no-drag',
        }}
      >
        {/* Listening rings */}
        <AnimatePresence>{isListening && <ListeningRings />}</AnimatePresence>

        {/* Processing spinner ring */}
        <AnimatePresence>{isProcessing && !isListening && <ProcessingRing />}</AnimatePresence>

        {/* Icon */}
        {isProcessing && !isListening ? <ProcessingDots /> : <LightningIcon />}
      </motion.button>

      {/* Idle breathing — separate element so it doesn't interfere with spring */}
      {!isListening && !isProcessing && (
        <motion.div
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
