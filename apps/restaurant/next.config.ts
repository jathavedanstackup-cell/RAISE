import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Single source of truth for local config lives at the monorepo root (see
// .env.example, docker-compose.yml) — same pattern as apps/api/src/main.ts.
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
