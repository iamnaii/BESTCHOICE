import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReverseReasonsService } from './reverse-reasons.service';
import { CreateReverseReasonDto } from './dto/create-reverse-reason.dto';
import { UpdateReverseReasonDto } from './dto/update-reverse-reason.dto';
import { ReorderReverseReasonsDto } from './dto/reorder-reverse-reasons.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * InternalControlActionBar — CRUD endpoints for the reverse-reason dropdown.
 *
 * Read path (`GET /settings/reverse-reasons`) is widened to OWNER+FM+ACC so
 * the ReverseConfirmDialog can render its dropdown for the same role bundle
 * that can post documents. Write path is OWNER-only — admin-managed list.
 */
@ApiTags('Settings - Reverse Reasons')
@ApiBearerAuth()
@Controller('settings/reverse-reasons')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReverseReasonsController {
  constructor(private readonly service: ReverseReasonsService) {}

  @Get('active')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List active reverse reasons (dropdown source)' })
  listActive() {
    return this.service.listActive();
  }

  @Get()
  @Roles('OWNER')
  @ApiOperation({ summary: 'List all reverse reasons (management view)' })
  listAll() {
    return this.service.listAll();
  }

  @Post()
  @Roles('OWNER')
  @ApiOperation({ summary: 'Create new reverse reason' })
  create(@Body() dto: CreateReverseReasonDto) {
    return this.service.create(dto);
  }

  @Put('reorder')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Bulk reorder reverse reasons' })
  reorder(@Body() dto: ReorderReverseReasonsDto) {
    return this.service.reorder(dto);
  }

  @Put(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Update reverse reason' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReverseReasonDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Soft-delete reverse reason' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
