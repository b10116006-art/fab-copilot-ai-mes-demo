/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "fab-bg": "#020617", // 整體背景
        "fab-panel": "#020617",
      },
      borderRadius: {
        fab: "18px",
      },
      boxShadow: {
        "fab-card": "0 0 25px rgba(56,189,248,0.15)",
      },
    },
  },
  plugins: [],
};
