/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Viewport-adjacent chrome. Deliberately desaturated so nothing in the
        // UI competes with the character or the markers drawn on it.
        panel: {
          DEFAULT: '#1a1c1f',
          light: '#22252a',
          lighter: '#2b2f36'
        },
        edge: '#34383f',
        ink: {
          DEFAULT: '#e6e8eb',
          dim: '#9aa1ab',
          faint: '#6b727c'
        },
        // Marker states. These are mirrored in src/viewport/palette.ts so the
        // 3D overlay and the checklist agree on what "placed" looks like.
        guide: {
          unplaced: '#5a616b',
          placed: '#4ea3ff',
          active: '#ffc447',
          hover: '#ffffff',
          error: '#ff5c5c'
        },
        curve: {
          DEFAULT: '#57e0a0',
          active: '#ffc447'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
