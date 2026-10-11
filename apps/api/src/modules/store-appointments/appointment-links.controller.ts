import {
  Body,
  Controller,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { AppointmentLinksService, publicAppointment } from './appointment-links.service';
import { StoreAppointmentsService } from './store-appointments.service';
import { IssueLinkDto, PublicBookDto, RescheduleDto, VersionDto } from './appointment.dto';
@Controller('store-appointment-links')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
export class AppointmentLinksController {
  constructor(private readonly links: AppointmentLinksService) {}
  @Get() @Header('Cache-Control', 'no-store') list(
    @Query('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.links.list(customerId, { staffId: req.user.id });
  }
  @Post() @Header('Cache-Control', 'no-store') issue(
    @Body() dto: IssueLinkDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.links.issue(dto, { staffId: req.user.id });
  }
  @Post(':id/revoke') revoke(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.links.revoke(id, { staffId: req.user.id });
  }
}
@Controller('store-appointments-public')
@Public()
@SkipCsrf()
@Throttle({ default: { limit: 40, ttl: 60_000 } })
export class AppointmentPublicController {
  constructor(
    private readonly links: AppointmentLinksService,
    private readonly appointments: StoreAppointmentsService,
  ) {}
  @Get('context') @Header('Cache-Control', 'no-store') context(
    @Headers('x-appointment-token') token: string,
  ) {
    return this.links.context(token);
  }
  @Get('availability') @Header('Cache-Control', 'no-store') async availability(
    @Headers('x-appointment-token') token: string,
    @Query('branchId') b: string,
    @Query('day') d: string,
    @Query('excludeId') e?: string,
  ) {
    return this.appointments.availability(b, d, await this.links.resolve(token), e);
  }
  @Post('book') @Header('Cache-Control', 'no-store') async book(
    @Headers('x-appointment-token') token: string,
    @Body() dto: PublicBookDto,
  ) {
    const actor = await this.links.resolve(token);
    return publicAppointment(
      await this.appointments.create(
        { ...dto, customerId: await this.links.customerId(actor) },
        actor,
      ),
    );
  }
  @Post(':id/reschedule') @Header('Cache-Control', 'no-store') async reschedule(
    @Headers('x-appointment-token') token: string,
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
  ) {
    return publicAppointment(
      await this.appointments.reschedule(id, dto, await this.links.resolve(token)),
    );
  }
  @Post(':id/cancel') @Header('Cache-Control', 'no-store') async cancel(
    @Headers('x-appointment-token') token: string,
    @Param('id') id: string,
    @Body() dto: VersionDto,
  ) {
    return publicAppointment(
      await this.appointments.transition(
        id,
        { ...dto, status: 'CANCELED' },
        await this.links.resolve(token),
      ),
    );
  }
}
