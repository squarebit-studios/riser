/** @type {import('tailwindcss').Config} */

// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Design tokens.
//
// Riser is a consumer product that happens to be 3D. The reference point is a
// phone app, not a DCC package: someone who has never rigged a character
// should be able to open it and know what to do. That principle decides most
// of what is below.
//
// SURFACES ARE LAYERED, NOT OUTLINED. Depth comes from a stack of near-black
// greys, so panels separate without a grid of hard borders. Borders are used
// where something is genuinely an edge, not as decoration.
//
// ONE ACCENT. Blue means "this is the thing to press" and nothing else uses
// it. An interface where six colours all mean "important" means none of them
// does.
//
// THE MARKER COLOURS ARE NOT FREE. `guide` and `curve` are mirrored in
// src/viewport/palette.ts so the checklist and the 3D overlay agree on what
// "placed" looks like. Change one, change the other.
// ==========================================================================

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Chrome. Desaturated on purpose - nothing here should compete with
        // the character or the markers drawn on it.
        panel: {
          // Deepest: the app background, and the well behind the viewport.
          DEFAULT: '#141619',
          // Panels and bars sit one step up.
          light: '#1c1f24',
          // Controls, rows and inputs sit one step above that.
          lighter: '#252930',
          // Hover and pressed states.
          hover: '#2f343c',
          active: '#383e47'
        },
        edge: {
          DEFAULT: '#2a2e35',
          strong: '#3a404a'
        },
        ink: {
          DEFAULT: '#eceef1',
          dim: '#a2aab5',
          faint: '#6d757f'
        },

        // The single accent. Used for the primary action, the current
        // selection, and focus - nothing else.
        accent: {
          DEFAULT: '#4ea3ff',
          hover: '#68b0ff',
          press: '#3d8ce0',
          soft: '#4ea3ff26',
          ink: '#08121d'
        },

        // Marker states. Mirrored in src/viewport/palette.ts.
        guide: {
          unplaced: '#5a616b',
          placed: '#4ea3ff',
          suggested: '#9b8cff',
          active: '#ffc447',
          hover: '#ffffff',
          error: '#ff5c5c'
        },
        curve: {
          DEFAULT: '#57e0a0',
          active: '#ffc447'
        },
        danger: {
          DEFAULT: '#ff5c5c',
          soft: '#ff5c5c1f'
        }
      },

      borderRadius: {
        // Controls are softer than a DCC tool and harder than a phone widget.
        control: '8px',
        panel: '12px',
        popover: '14px'
      },

      boxShadow: {
        // Popovers float above everything; the ring is what separates them
        // from the panel behind, since both are dark.
        popover: '0 12px 32px -8px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.07)',
        raised: '0 1px 2px rgba(0,0,0,0.4)',
        focus: '0 0 0 2px #141619, 0 0 0 4px #4ea3ff'
      },

      fontFamily: {
        // System first, deliberately. It renders the way the user's other
        // applications do, needs no network request, and is what makes an
        // interface feel native rather than themed.
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI Variable Text',
          'Segoe UI',
          'Inter',
          'Roboto',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },

      transitionDuration: {
        // Fast enough to feel like a response, slow enough to be seen.
        DEFAULT: '120ms'
      },

      keyframes: {
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        }
      },
      animation: {
        'pop-in': 'pop-in 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 120ms ease-out'
      }
    }
  },
  plugins: []
};
