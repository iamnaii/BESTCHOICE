import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LateFeeWaiverStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LateFeeWaiverService } from './late-fee-waiver.service';
import { CreateLateFeeWaiverDto } from './dto/create-request.dto';
import { RejectLateFeeWaiverDto } from './dto/approve-reject.dto';

@Controller('late-fee-waivers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LateFeeWaiverController {
  constructor(private readonly service: LateFeeWaiverService) {}

  /**
   * Collector creates a waiver request. SALES role is the typical caller
   * (collector). Manager-tier roles can also raise requests on a collector's
   * behalf — useful when a customer escalates a complaint.
   */
  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER')
  create(
    @Body() dto: CreateLateFeeWaiverDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(dto, user.id);
  }

  /**
   * OWNER queue. Defaults to PENDING (approval drawer view); pass
   * ?status=APPROVED|REJECTED for history.
   */
  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  list(@Query('status') status?: LateFeeWaiverStatus) {
    return this.service.list(status);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.approve(id, user.id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectLateFeeWaiverDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.reject(id, user.id, dto.reason);
  }
}
