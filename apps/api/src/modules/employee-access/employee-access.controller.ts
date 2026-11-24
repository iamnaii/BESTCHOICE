import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessSnapshotService } from './access-snapshot.service';
import { EmployeeAccessConsoleService } from './employee-access-console.service';
import { EmployeeAccessService } from './employee-access.service';
import {
  CreateAccessPositionDto,
  EmployeeAccessHistoryQueryDto,
  ReplaceAccessAssignmentsDto,
  UpdateAccessPositionDto,
} from './employee-access.dto';

const STAFF_ROLES = Object.values(UserRole);
@Controller('employee-access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeeAccessController {
  constructor(
    private readonly service: EmployeeAccessService,
    private readonly snapshots: AccessSnapshotService,
    private readonly consoleService: EmployeeAccessConsoleService,
  ) {}
  @Get('me')
  @Roles(...STAFF_ROLES)
  me(@CurrentUser('id') id: string) {
    return this.snapshots.forUser(id);
  }
  @Get('catalog')
  @Roles(...STAFF_ROLES)
  catalog(@CurrentUser('id') id: string) {
    return this.service.catalog(id);
  }
  @Get('context')
  @Roles('OWNER')
  context(@CurrentUser('id') actorId: string) {
    return this.consoleService.context(actorId);
  }
  @Get('positions')
  @Roles('OWNER')
  positions(@CurrentUser('id') id: string) {
    return this.service.positions(id);
  }
  @Post('positions')
  @Roles('OWNER')
  createPosition(@CurrentUser('id') id: string, @Body() dto: CreateAccessPositionDto) {
    return this.service.createPosition(id, dto);
  }
  @Post('positions/seed-templates')
  @Roles('OWNER')
  seedTemplates(@CurrentUser('id') id: string) {
    return this.service.seedTemplates(id);
  }
  @Patch('positions/:id')
  @Roles('OWNER')
  updatePosition(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccessPositionDto,
  ) {
    return this.service.updatePosition(actorId, id, dto);
  }
  @Get('employees')
  @Roles('OWNER')
  employees(@CurrentUser('id') id: string) {
    return this.service.employees(id);
  }
  @Get('employees/:id/effective-access')
  @Roles('OWNER')
  effectiveAccess(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.consoleService.effectiveAccess(actorId, id);
  }
  @Put('employees/:id/assignments')
  @Roles('OWNER')
  assignments(
    @CurrentUser('id') actorId: string,
    @Param('id') id: string,
    @Body() dto: ReplaceAccessAssignmentsDto,
  ) {
    return this.service.replaceAssignments(actorId, id, dto);
  }
  @Get('history')
  @Roles('OWNER')
  history(@CurrentUser('id') actorId: string, @Query() query: EmployeeAccessHistoryQueryDto) {
    return this.consoleService.history(actorId, query);
  }
  @Get('migration-preview')
  @Roles('OWNER')
  migrationPreview(@CurrentUser('id') id: string) {
    return this.service.migrationPreview(id);
  }
}
