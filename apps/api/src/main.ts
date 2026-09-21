import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Single source of truth for local config lives at the monorepo root
// (see .env.example, docker-compose.yml) — load it explicitly.
loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CP7 — native `ws`, not Socket.IO: gives VisitsGateway direct access to
  // the raw upgrade request (Sec-WebSocket-Protocol, Origin) the
  // ticket-exchange design needs. See docs/decisions.md.
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();
