/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Effectively disabled; no dark classes are generated or used
  theme: {
    // Override colors completely so stock Tailwind colors (slate, blue, red, etc.) are NOT available
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      canvas: 'var(--canvas)',
      surface: 'var(--surface)',
      'surface-sunken': 'var(--surface-sunken)',
      'surface-hover': 'var(--surface-hover)',
      border: 'var(--border)',
      'border-strong': 'var(--border-strong)',
      ink: 'var(--ink)',
      'ink-2': 'var(--ink-2)',
      'ink-muted': 'var(--ink-muted)',
      primary: 'var(--primary)',
      'primary-hover': 'var(--primary-hover)',
      'primary-weak': 'var(--primary-weak)',
      ok: 'var(--ok)',
      'ok-weak': 'var(--ok-weak)',
      warn: 'var(--warn)',
      'warn-weak': 'var(--warn-weak)',
      crit: 'var(--crit)',
      'crit-weak': 'var(--crit-weak)',
      offline: 'var(--offline)',
      'cat-1': 'var(--cat-1)',
      'cat-2': 'var(--cat-2)',
      'cat-3': 'var(--cat-3)',
      'cat-4': 'var(--cat-4)',
      'cat-5': 'var(--cat-5)',
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['"JetBrains Mono"', 'monospace'],
    },
    fontSize: {
      '11': ['11px', { lineHeight: '1.45', letterSpacing: '0.04em' }],
      '12': ['12px', { lineHeight: '1.45' }],
      '13': ['13px', { lineHeight: '1.45' }],
      '14': ['14px', { lineHeight: '1.45' }],
      '16': ['16px', { lineHeight: '1.45' }],
      '20': ['20px', { lineHeight: '1.2' }],
      '24': ['24px', { lineHeight: '1.2' }],
      '32': ['32px', { lineHeight: '1.2' }],
    },
    boxShadow: {
      card: '0 1px 2px rgba(60,64,67,.08)',
      panel: '0 1px 3px rgba(60,64,67,.12)',
      none: 'none',
    },
    borderRadius: {
      none: '0',
      sm: '4px',
      DEFAULT: '6px',
      md: '6px',
      lg: '8px',
      full: '9999px',
    },
    extend: {
      spacing: {
        '14': '56px', // app bar 56px
        '64': '256px', // nav 256px
        '90': '360px', // detail panel 360px
      },
    },
  },
  plugins: [],
}
