import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FilterPresetsService } from './filter-presets.service';
import { CreatePresetDto } from './dto/create-preset.dto';

@ApiTags('FilterPresets')
@ApiBearerAuth('JWT')
@Controller('filter-presets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilterPresetsController {
  constructor(private readonly service: FilterPresetsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  list(
    @Query('page') page: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.service.list({
      userId: user.id,
      userRole: user.role,
      branchId: user.branchId,
      page: page ?? 'collections-queue',
    });
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  create(
    @Body() dto: CreatePresetDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.service.create(dto, user.id, user.role, user.branchId);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.delete(id, user.id, user.role);
  }
}
