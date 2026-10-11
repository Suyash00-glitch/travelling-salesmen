import { readFileSync } from 'node:fs';

// Same server as the app's DATABASE_URL, but a separate database called loomos_test.
export function testDatabaseUrl() {
  const fromFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('DATABASE_URL='))
    ?.slice('DATABASE_URL='.length);
  const base = process.env.DATABASE_URL ?? fromFile;
  if (!base) throw new Error('DATABASE_URL is not set');
  return base.replace(/\/[^/?]+\?/, '/loomos_test?');
}
