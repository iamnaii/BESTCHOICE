/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* ── Thai-friendly font scale ─────────────────────────
         TH Sarabun PSK renders smaller than Latin fonts at the
         same px value.  Bump every step ~1-2px so Thai text
         stays legible, especially at the small end.
         ──────────────────────────────────────────────────── */
      fontSize: {
        'xs':   ['13px', { lineHeight: '1.5' }],
        'sm':   ['15px', { lineHeight: '1.55' }],
        'base': ['17px', { lineHeight: '1.6' }],
        'lg':   ['19px', { lineHeight: '1.55' }],
        'xl':   ['21px', { lineHeight: '1.5' }],
        '2xl':  ['26px', { lineHeight: '1.4' }],
        '3xl':  ['32px', { lineHeight: '1.35' }],
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
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
      },
    },
  },
  plugins: [],
};
