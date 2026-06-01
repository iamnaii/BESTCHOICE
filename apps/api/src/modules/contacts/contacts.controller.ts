import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactsDto } from './dto/merge-contacts.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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
  merge(@Body() dto: MergeContactsDto) {
    return this.contacts.merge(dto);
  }
}
