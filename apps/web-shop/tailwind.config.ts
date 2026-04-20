import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'hsl(160 84% 39%)', foreground: 'hsl(0 0% 100%)' },
        background: 'hsl(0 0% 100%)',
        foreground: 'hsl(240 10% 3.9%)',
        muted: 'hsl(240 4.8% 95.9%)',
        'muted-foreground': 'hsl(240 3.8% 46.1%)',
        border: 'hsl(240 5.9% 90%)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Thai"', 'Inter', 'sans-serif'],
      },
    },
  },
} satisfies Config;
