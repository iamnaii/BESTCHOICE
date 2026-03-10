/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* ── Thai-friendly font scale ─────────────────────────
         TH Sarabun PSK renders smaller than Latin fonts at the
         same px value.  Bump every step so Thai text stays
         legible, especially at the small end.
         ──────────────────────────────────────────────────── */
      fontSize: {
        'xs':   ['14px', { lineHeight: '1.5' }],
        'sm':   ['16px', { lineHeight: '1.55' }],
        'base': ['18px', { lineHeight: '1.6' }],
        'lg':   ['20px', { lineHeight: '1.55' }],
        'xl':   ['23px', { lineHeight: '1.5' }],
        '2xl':  ['28px', { lineHeight: '1.4' }],
        '3xl':  ['34px', { lineHeight: '1.35' }],
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-out',
        slideUp: 'slideUp 0.5s ease-out',
        float: 'float 3s ease-in-out infinite',
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a5f',
          950: '#0f172a',
        },
      },
    },
  },
  plugins: [],
};
