/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--bg-primary)',
          muted: 'var(--bg-secondary)',
          accent: 'var(--bg-accent)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          muted: 'var(--text-secondary)',
          faint: 'var(--text-muted)',
        },
        line: 'var(--border-color)',
        brand: {
          black: 'var(--color-black)',
          red: 'var(--color-red)',
          gold: 'var(--color-gold)',
        },
        party: {
          cdu: 'var(--party-cdu)',
          spd: 'var(--party-spd)',
          grune: 'var(--party-grune)',
          fdp: 'var(--party-fdp)',
          afd: 'var(--party-afd)',
          linke: 'var(--party-linke)',
          csu: 'var(--party-csu)',
          ssw: 'var(--party-ssw)',
        },
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
