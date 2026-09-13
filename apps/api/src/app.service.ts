import { Injectable } from '@nestjs/common';
import type { ServiceHealth } from '@raise/shared-types';

@Injectable()
export class AppService {
  getHello(): string {
    return 'RAISE API — scaffold placeholder. See docs/checkpoints/CP01-data-model.md for the next checkpoint.';
  }

  getHealth(): ServiceHealth {
    return { service: 'api', status: 'ok' };
  }
}
