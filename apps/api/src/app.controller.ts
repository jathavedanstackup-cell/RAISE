import { Controller, Get } from '@nestjs/common';
import type { ServiceHealth } from '@raise/shared-types';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): ServiceHealth {
    return this.appService.getHealth();
  }
}
