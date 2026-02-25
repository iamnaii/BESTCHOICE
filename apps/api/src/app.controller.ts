import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  healthCheck() {
    return {
      status: 'ok',
      service: 'installment-api',
      timestamp: new Date().toISOString(),
    };
  }
}
