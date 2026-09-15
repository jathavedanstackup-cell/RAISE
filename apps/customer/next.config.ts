import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Single source of truth for local config lives at the monorepo root (see
// .env.example, docker-compose.yml) — same pattern as apps/restaurant's
// next.config.ts and apps/api/src/main.ts. CP4 needs API_BASE_URL here to
// reach apps/api from this app's own Route Handlers (app/api/intake/*).
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
