/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/templates/**/*.html",
    "./app/static/js/**/*.js"
  ],
  darkMode: 'class',
  theme: {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        brand: {
                            pink: '#fffcfa',
                            grey: '#333',
                            claret: '#990f3d',
                            teal: '#0d7680',
                            oxford: '#0f5499',
                            slate: '#262a33',
                            paper: '#f2dfce',
                            wheat: '#f2dfce',
                            'black-80': '#33302e',
                            'black-70': '#4d4845',
                            'black-60': '#66605c',
                            'terminal-black': '#000000',
                            'terminal-surface': '#1a1a1a',
                        }
                    },
                    fontFamily: {
                        serif: ['Georgia', 'serif'],
                        sans: ['Inter', 'sans-serif'],
                        ui: ['Inter', 'sans-serif'],
                    }
                }
            }
        }
};
