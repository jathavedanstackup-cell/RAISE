import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MenuItemsModule } from './menu-items/menu-items.module.js';
import { IntakeModule } from './intake/intake.module.js';
import { VisitsModule } from './visits/visits.module.js';
import { TimingModule } from './timing/timing.module.js';

@Module({
  imports: [
    // CP6: in-process realtime event bus (visit.timing.recomputed,
    // visit.kitchen.accepted) for CP7/CP8 to subscribe to later — see
    // timing.events.ts. Registered once, at the root, per NestJS's own
    // documented pattern (docs.nestjs.com/techniques/events).
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    MenuItemsModule,
    IntakeModule,
    VisitsModule,
    TimingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
