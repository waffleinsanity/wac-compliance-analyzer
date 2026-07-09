/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f4f7f5',
          100: '#e3ebe6',
          200: '#c5d6cb',
          300: '#9bb8a6',
          400: '#6f957f',
          500: '#4f7861',
          600: '#3c5f4c',
          700: '#314c3e',
          800: '#293e34',
          900: '#22342c',
          950: '#111c17',
        },
        cedar: {
          400: '#c4a574',
          500: '#b08a52',
          600: '#957040',
        },
        tide: {
          400: '#5b9aaf',
          500: '#3d7f96',
          600: '#316678',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        panel: '0 12px 40px -18px rgba(17, 28, 23, 0.45)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        rise: 'rise 0.45s ease-out both',
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
