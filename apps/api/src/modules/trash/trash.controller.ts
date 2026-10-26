import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TrashService } from './trash.service';
import { ListTrashDto, RestoreTrashDto, TrashTypesDto } from './dto/trash.dto';

interface ActingUser {
  id: string;
  role?: string;
}

/** ถังขยะรวม (ก้อน 8 · A10) — OWNER เท่านั้น (สเปก §3) · ไม่มี endpoint ลบถาวร */
@Controller('trash')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class TrashController {
  constructor(private readonly service: TrashService) {}

  @Get('types')
  @Roles('OWNER')
  async types(@Query() query: TrashTypesDto) {
    return { types: await this.service.listTypes(query.days) };
  }

  @Get()
  @Roles('OWNER')
  async list(@Query() query: ListTrashDto) {
    return this.service.list({ type: query.type, q: query.q, days: query.days, page: query.page, pageSize: query.pageSize });
  }

  @Post(':type/:id/restore')
  @Roles('OWNER')
  async restore(@Param('type') type: string, @Param('id') id: string, @CurrentUser() user: ActingUser) {
    return this.service.restore(type, id, user);
  }

  @Post('restore')
  @Roles('OWNER')
  async restoreMany(@Body() body: RestoreTrashDto, @CurrentUser() user: ActingUser) {
    return this.service.restoreMany(body.items, user);
  }
}
