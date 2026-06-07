/** @type {import('tailwindcss').Config} */
module.exports = {
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
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        ui: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

