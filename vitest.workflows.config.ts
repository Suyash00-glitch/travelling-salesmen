import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './backend/tests/test-db.js';

// End-to-end workflow tests for the API, run against a throwaway `loomos_test` database.
// Needs the Postgres container running: `docker compose up -d`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['backend/tests/**/*.test.ts'],
    globalSetup: ['backend/tests/global-setup.ts'],
    env: { DATABASE_URL: testDatabaseUrl(), NODE_ENV: 'test' },
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
