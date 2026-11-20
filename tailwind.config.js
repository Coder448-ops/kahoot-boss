/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#080810',
        panel: '#11111D',
        panel2: '#161624',
        panel3: '#1C1C2E',
        line: 'rgba(148, 148, 180, 0.14)',
        accent: '#8B5CF6',
        accent2: '#06B6D4',
        ink: '#F8FAFC',
        muted: '#9292A8',
        good: '#34D399',
        warn: '#FBBF24',
        bad: '#F87171',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(139, 92, 246, 0.45)',
        glow2: '0 0 40px -10px rgba(6, 182, 212, 0.35)',
        card: '0 12px 40px -12px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'gradient-pan': 'gradientPan 14s ease-in-out infinite alternate',
        'fade-up': 'fadeUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'spin-slow': 'spin 1.2s linear infinite',
        shimmer: 'shimmer 1.8s linear infinite',
      },
      keyframes: {
        gradientPan: {
          '0%': { transform: 'translate(-6%, -4%) scale(1)', opacity: '0.7' },
          '50%': { transform: 'translate(5%, 3%) scale(1.08)', opacity: '1' },
          '100%': { transform: 'translate(-3%, 5%) scale(1.04)', opacity: '0.8' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        shimmer: {
          from: { backgroundPosition: '-400px 0' },
          to: { backgroundPosition: '400px 0' },
        },
      },
    },
  },
  plugins: [],
};
