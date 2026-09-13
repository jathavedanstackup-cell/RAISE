import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Single source of truth for local config lives at the monorepo root
// (see .env.example, docker-compose.yml) — load it explicitly.
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();
