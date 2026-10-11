import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from './test-db.js';

// Creates a fresh, empty `loomos_test` database for every run. The demo database is never touched.
export default async function setup() {
  const url = testDatabaseUrl();
  const admin = new PrismaClient({ datasourceUrl: url.replace(/\/loomos_test\?/, '/postgres?') });
  await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS loomos_test WITH (FORCE)');
  await admin.$executeRawUnsafe('CREATE DATABASE loomos_test');
  await admin.$disconnect();

  execSync('npx prisma migrate deploy --schema packages/db/prisma/schema.prisma', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  });
}
