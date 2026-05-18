import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OutboxService } from './outbox.service';

@Controller('admin/outbox')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class ReconcileController {
  constructor(private readonly outbox: OutboxService) {}

  @Get('failed')
  async listFailed() {
    return this.outbox.findFailed();
  }

  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.outbox.retry(id);
  }
}
