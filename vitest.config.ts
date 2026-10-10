import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'packages/**/*.test.{ts,tsx}',
      'frontend/src/**/*.test.{ts,tsx}',
      'backend/src/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
