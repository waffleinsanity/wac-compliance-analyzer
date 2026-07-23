/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Investigation UI tokens — cool slate ink + pine accent
        ink: {
          50: '#f4f5f7',
          100: '#e9ebef',
          200: '#d3d8e0',
          300: '#b0b8c5',
          400: '#8490a1',
          500: '#667385',
          600: '#4f5b6b',
          700: '#3c4553',
          800: '#2c333e',
          900: '#1a1f27',
          950: '#0f1217',
        },
        tide: {
          300: '#5a9e8f',
          400: '#3d8274',
          500: '#2a6b5e',
          600: '#1f554a',
          700: '#18433b',
        },
        cedar: {
          500: '#9a6b2f',
          600: '#7a5424',
        },
      },
      fontFamily: {
        sans: ['"Public Sans"', 'Segoe UI', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'serif'],
        display: ['Newsreader', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 1px)',
        sm: 'calc(var(--radius) - 2px)',
      },
      boxShadow: {
        soft: '0 1px 0 rgba(26, 31, 39, 0.04)',
        panel: '0 1px 0 rgba(26, 31, 39, 0.04)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        draw: {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },
      animation: {
        rise: 'rise 240ms ease-out',
        draw: 'draw 420ms ease-out forwards',
      },
    },
  },
  plugins: [],
}
