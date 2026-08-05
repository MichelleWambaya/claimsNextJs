/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        aar: {
          orange: "#F3781F",
          "orange-hover": "#D9640F",
          black: "#1a1a1a",
        },
      },
    },
  },
  plugins: [],
};
