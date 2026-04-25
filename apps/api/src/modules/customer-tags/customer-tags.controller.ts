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
import { CustomerTagsService } from './customer-tags.service';
import { CreateTagDto } from './dto/create-tag.dto';

/**
 * CustomerTag CRUD + recompute (P3 Task 6).
 *
 * Read endpoints are open to all authenticated roles (chips render on the
 * collections card for SALES too). Mutating endpoints (manual apply / remove /
 * recompute) gate to OWNER + FINANCE_MANAGER — segmentation tags drive dunning
 * behaviour and finance reporting, so we keep the surface tight.
 */
@ApiTags('CustomerTags')
@ApiBearerAuth('JWT')
@Controller('customer-tags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerTagsController {
  constructor(private readonly service: CustomerTagsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Query('customerId') customerId: string) {
    return this.service.listForCustomer(customerId);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER')
  create(
    @Body() dto: CreateTagDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.applyTag(dto.customerId, dto.tag, 'MANUAL', dto.reason, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.removeById(id, user.id);
  }

  /**
   * Recompute auto-tag rules for a single customer. All authenticated staff
   * may trigger it (read-only effect on the customer they're servicing — no
   * destructive blast radius beyond a single customer's auto tags).
   */
  @Post('recompute/:customerId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  recompute(@Param('customerId') customerId: string) {
    return this.service.recomputeForCustomer(customerId);
  }
}
