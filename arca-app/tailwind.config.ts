import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#534AB7',
        'primary-light': '#EEEDFE',
        'primary-mid': '#AFA9EC',
        success: '#1D9E75',
        background: '#0F0F12',
        surface: '#1A1A24',
        'text-main': '#F0EFF8',
        'text-muted': '#8B8AA0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '20px',
      },
      boxShadow: {
        orb: '0 0 32px rgba(83,74,183,0.5)',
        panel: '0 8px 40px rgba(0,0,0,0.6)',
      },
      animation: {
        breathe: 'breathe 3s ease-in-out infinite',
        pulse_ring: 'pulse_ring 1.5s ease-out infinite',
        spin_slow: 'spin 2s linear infinite',
        fadeSlideUp: 'fadeSlideUp 0.3s ease-out forwards',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.04)' },
        },
        pulse_ring: {
          '0%': { transform: 'scale(1)', opacity: '0.8' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        fadeSlideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
