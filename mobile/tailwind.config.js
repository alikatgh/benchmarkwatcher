/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset")],
  content: ["./App.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./screen/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens mirrored from the web FT palette (tailwind.web.config.js)
        brand: {
          paper: '#fffcfa', wheat: '#f2dfce',
          claret: '#990f3d', teal: '#0d7680', oxford: '#0f5499',
          ink: '#33302e', 'ink-70': '#4d4845', 'ink-60': '#66605c',
        },
        // Re-tone stock ramps so the app's existing slate/blue/indigo classes
        // render on-brand with zero per-file edits (cascade — CLAUDE.md §4c).
        // Warm FT neutral (paper → terminal) replaces cool slate:
        slate: {
          50: '#f7f4f0', 100: '#f2ece4', 200: '#e7e0d6', 300: '#d8cfc2',
          400: '#9b938b', 500: '#66605c', 600: '#4d4845', 700: '#33302e',
          800: '#13171f', 900: '#0a0c10',
        },
        // Oxford-blue (light) / teal (dark) accent replaces stock blue + indigo:
        blue: {
          50: '#eef4fa', 100: '#d8e6f3', 200: '#b3cde8', 300: '#7fa9d4',
          400: '#0d7680', 500: '#0f5499', 600: '#0f5499', 700: '#0d4a85',
          800: '#0a3a68', 900: '#0a3a68', 950: '#0a2a4d',
        },
        indigo: {
          50: '#eef4fa', 100: '#d8e6f3', 200: '#b3cde8', 300: '#7fa9d4',
          400: '#0d7680', 500: '#0f5499', 600: '#0f5499', 700: '#0d4a85',
          800: '#0a3a68', 900: '#0a3a68', 950: '#0a2a4d',
        },
        // Brand teal replaces stock emerald (up/success), claret replaces rose
        // (down/error) — market colors match the web claret/teal semantics:
        emerald: {
          50: '#e7f1f2', 100: '#cfe4e6', 200: '#9fc8cc', 300: '#6fadb3',
          400: '#3f9199', 500: '#0d7680', 600: '#0b656e', 700: '#09545b',
          800: '#074248', 900: '#053136', 950: '#032024',
        },
        rose: {
          50: '#f7e7ed', 100: '#efcfdb', 200: '#df9fb7', 300: '#cf6f93',
          400: '#bf3f6f', 500: '#990f3d', 600: '#870d36', 700: '#740b2e',
          800: '#620a27', 900: '#4f081f', 950: '#3d0618',
        },
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        ui: ['Inter', 'sans-serif'],
      },
      fontSize: {
        // Micro-label token — replaces ad-hoc text-[9/10px] (web --text-2xs twin)
        '2xs': ['10px', { lineHeight: '14px' }],
      },
    },
  },
  plugins: [],
}

