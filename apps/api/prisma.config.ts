import { defineConfig } from 'prisma/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Prisma 7 does not auto-load .env files. The repo's single source of
// truth for local config lives at the monorepo root (see .env.example,
// docker-compose.yml) — load it explicitly rather than duplicating a
// second .env inside apps/api.
loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
