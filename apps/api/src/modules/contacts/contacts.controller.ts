import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ContactsService } from './contacts.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';
import { EnsureRoleDto } from './dto/ensure-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

type AuthRequest = Request & { user?: { id: string; role: string } };

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  list(@Query() dto: ListContactsDto) {
    return this.contacts.list(dto);
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string) {
    return this.contacts.findOne(id);
  }

  @Post('merge')
  @Roles('OWNER')
  merge(@Body() dto: MergeContactsDto, @Req() req: AuthRequest) {
    return this.contacts.merge(dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }

  @Post(':id/ensure-role')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  ensureRole(@Param('id') id: string, @Body() dto: EnsureRoleDto, @Req() req: AuthRequest) {
    return this.contacts.ensureRole(id, dto.role, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
  }
}
