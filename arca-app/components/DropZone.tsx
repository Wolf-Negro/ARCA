'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface DropZoneProps {
  isVisible: boolean
}

function DownArrowIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="rgba(175,169,236,0.7)" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

export function DropZone({ isVisible }: DropZoneProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="dropzone"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9997,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10,10,18,0.72)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            WebkitAppRegion: 'no-drag',
          }}
        >
          <motion.div
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: '40px 56px',
              border: '2px dashed rgba(83,74,183,0.55)',
              borderRadius: 20,
              background: 'rgba(83,74,183,0.07)',
            }}
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <DownArrowIcon />
            </motion.div>
            <p style={{
              color: 'rgba(255,255,255,0.65)',
              fontSize: 14,
              fontWeight: 500,
              margin: 0,
            }}>
              Suelta para guardar
            </p>
            <p style={{
              color: 'rgba(255,255,255,0.28)',
              fontSize: 11,
              margin: 0,
            }}>
              PDF, Word, Excel, imágenes
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
