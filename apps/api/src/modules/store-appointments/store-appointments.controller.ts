import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StoreAppointmentsService } from './store-appointments.service';
import { AppointmentScheduleService } from './appointment-schedule.service';
import {
  CopyDayDto,
  CreateAppointmentDto,
  ReassignDto,
  RescheduleDto,
  StatusDto,
  WindowDto,
  WindowVersionDto,
} from './appointment.dto';
type StaffRequest = { user: { id: string } };
@Controller('store-appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
export class StoreAppointmentsController {
  constructor(
    private readonly appointments: StoreAppointmentsService,
    private readonly schedule: AppointmentScheduleService,
  ) {}
  @Post(':id/confirmation/retry') retryConfirmation(
    @Param('id') id: string,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.retryConfirmation(id, { staffId: r.user.id });
  }
  @Get('room-summaries') roomSummaries(@Query('roomIds') ids: string, @Req() r: StaffRequest) {
    return this.appointments.roomSummaries((ids || '').split(',').filter(Boolean), {
      staffId: r.user.id,
    });
  }
  @Get('due') due(@Req() r: StaffRequest) {
    return this.appointments.due({ staffId: r.user.id });
  }
  @Get('options') options(@Req() r: StaffRequest) {
    return this.schedule.options({ staffId: r.user.id });
  }
  @Post('windows/copy') copyDay(@Body() dto: CopyDayDto, @Req() r: StaffRequest) {
    return this.schedule.copyDay(dto.branchId, dto.fromDay, dto.toDay, { staffId: r.user.id });
  }
  @Get('windows') windows(
    @Query('branchId') b: string,
    @Query('day') d: string,
    @Req() r: StaffRequest,
  ) {
    return this.schedule.list(b, d, { staffId: r.user.id });
  }
  @Post('windows') saveWindow(@Body() dto: WindowDto, @Req() r: StaffRequest) {
    return this.schedule.save(dto, { staffId: r.user.id });
  }
  @Delete('windows/:id') removeWindow(
    @Param('id') id: string,
    @Body() dto: WindowVersionDto,
    @Req() r: StaffRequest,
  ) {
    return this.schedule.remove(id, dto.version, { staffId: r.user.id });
  }
  @Get('availability') availability(
    @Query('branchId') b: string,
    @Query('day') d: string,
    @Query('excludeId') e: string | undefined,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.availability(b, d, { staffId: r.user.id }, e);
  }
  @Get('eligibility/:customerId') eligibility(
    @Param('customerId') c: string,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.eligibility(c, { staffId: r.user.id });
  }
  @Get() list(
    @Query()
    q: { day?: string; branchId?: string; customerId?: string; roomId?: string; open?: string },
    @Req() r: StaffRequest,
  ) {
    return this.appointments.list({ ...q, open: q.open === 'true' }, { staffId: r.user.id });
  }
  @Get(':id') detail(@Param('id') id: string, @Req() r: StaffRequest) {
    return this.appointments.findOne(id, { staffId: r.user.id });
  }
  @Post() create(@Body() dto: CreateAppointmentDto, @Req() r: StaffRequest) {
    return this.appointments.create(dto, { staffId: r.user.id });
  }
  @Post(':id/reschedule') reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.reschedule(id, dto, { staffId: r.user.id });
  }
  @Post(':id/reassign') reassign(
    @Param('id') id: string,
    @Body() dto: ReassignDto,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.reassign(id, dto, { staffId: r.user.id });
  }
  @Post(':id/status') status(
    @Param('id') id: string,
    @Body() dto: StatusDto,
    @Req() r: StaffRequest,
  ) {
    return this.appointments.transition(id, dto, { staffId: r.user.id });
  }
}
