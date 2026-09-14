import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // APP_DATABASE_URL connects as the restricted "raise_app" role, not the
    // migration/owner role in DATABASE_URL. The owner role is a Postgres
    // superuser locally and in CI, and superusers always bypass Row Level
    // Security — so the app's runtime connection must NOT be that role, or
    // every tenant-isolation policy from CP2's migration is dead code. See
    // docs/decisions.md ("Tenant-isolation enforcement layer").
    super({
      adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
