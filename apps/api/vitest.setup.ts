import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Same single-source-of-truth root .env as main.ts / prisma.config.ts —
// the CRUD specs under src/prisma need DATABASE_URL to reach Postgres.
loadEnv({ path: resolve(import.meta.dirname, '../../.env') });
