import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SnoozeService } from './services/snooze.service';

@Controller('staff-chat/snooze')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SnoozeController {
  constructor(private snoozeService: SnoozeService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async create(
    @Body() body: { sessionId: string; remindAt: string; note?: string },
    @Req() req: any,
  ) {
    return this.snoozeService.createSnooze(
      body.sessionId,
      req.user.id,
      new Date(body.remindAt),
      body.note,
    );
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async cancel(@Param('id') id: string) {
    await this.snoozeService.cancelSnooze(id);
    return { success: true };
  }

  @Get('my')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getMySnoozes(@Req() req: any) {
    return this.snoozeService.getActiveSnoozes(req.user.id);
  }
}
