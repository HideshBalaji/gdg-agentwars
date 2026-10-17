/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#04060c',
        night: { 900: '#070b14', 800: '#0b111d', 700: '#101828', 600: '#172133', 500: '#22304a' },
        ink: { DEFAULT: '#e6edf7', muted: '#93a3bd', dim: '#5b6a84', faint: '#36435a' },
        ice: { 300: '#a5f3fc', 400: '#67e8f9', 500: '#22d3ee', 600: '#0891b2' },
        ghost: { 300: '#d8ccff', 400: '#b4a1ff', 500: '#8b74f8' },
        mint: { 400: '#4ade80', 500: '#22c55e' },
        ember: { 400: '#fbbf24', 500: '#f59e0b' },
        alarm: { 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(148,180,255,0.07), 0 20px 50px -20px rgba(0,0,0,0.8)',
        glow: '0 0 24px -4px var(--glow, rgba(34,211,238,0.6))',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        scan: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
        blink: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-3px)' } },
        drift: {
          '0%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(4%, -3%) scale(1.08)' },
          '100%': { transform: 'translate(0,0) scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        scan: 'scan 6s linear infinite',
        blink: 'blink 1.1s ease-in-out infinite',
        float: 'float 3.2s ease-in-out infinite',
        drift: 'drift 22s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
