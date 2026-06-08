/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a', 950: '#172554',
        },
        sidebar: {
          bg: '#0f172a',
          hover: 'rgba(255,255,255,0.06)',
          active: 'rgba(255,255,255,0.12)',
          border: 'rgba(255,255,255,0.07)',
          text: '#94a3b8',
          'text-active': '#ffffff',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-md': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
        'card-lg': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05)',
        'modal': '0 20px 40px -8px rgba(0,0,0,0.20), 0 8px 16px -4px rgba(0,0,0,0.12)',
        'btn': '0 1px 2px 0 rgba(0,0,0,0.08)',
        'input-focus': '0 0 0 3px rgba(59,130,246,0.15)',
      },
      keyframes: {
        'slide-in': { from: { opacity: '0', transform: 'translateX(1rem)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'fade-in': 'fade-in 0.18s ease-out',
        'scale-in': 'scale-in 0.15s ease-out',
      },
    },
  },
  plugins: [],
}
