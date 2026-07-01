/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        background: '#ffffff',
        foreground: '#111827',
        primary: {
          DEFAULT: '#16a34a',
          dark: '#15803d',
        },
        secondary: {
          DEFAULT: '#111827',
          dark: '#030712',
        },
        muted: {
          DEFAULT: '#f3f4f6',
        },
        subtitle: {
          DEFAULT: '#6b7280',
        },
        success: {
          DEFAULT: '#16a34a',
        },
        error: {
          DEFAULT: '#dc2626',
        },
        border: '#e5e7eb',
        ring: '#16a34a',
      },
      borderRadius: {
        lg: '1rem',
        md: '0.75rem',
        sm: '0.5rem',
      },
      boxShadow: {
        phone: '0 30px 80px rgba(17, 24, 39, 0.14)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
