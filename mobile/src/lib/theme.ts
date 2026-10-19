import { useColorScheme } from 'react-native';

// Same tokens as the desktop app (desktop/renderer/styles.css).
const dark = {
  bg: '#0f1115',
  panel: '#171a21',
  panel2: '#1e222b',
  border: '#2a2f3a',
  text: '#e6e8ee',
  muted: '#8b93a5',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  grey: '#94a3b8',
  blue: '#60a5fa',
};

const light: Theme = {
  ...dark,
  bg: '#f5f6f8',
  panel: '#ffffff',
  panel2: '#f0f2f5',
  border: '#dde1e8',
  text: '#151821',
  muted: '#616a7d',
};

export type Theme = typeof dark;
export type StatusColor = 'green' | 'amber' | 'red' | 'grey';

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const mono = 'monospace';
