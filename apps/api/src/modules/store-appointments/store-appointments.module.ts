import { ChatEngineModule } from '../chat-engine/chat-engine.module';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { Module } from '@nestjs/common';
import { StoreAppointmentsController } from './store-appointments.controller';
import { StoreAppointmentsService } from './store-appointments.service';
import { AppointmentScheduleService } from './appointment-schedule.service';
import { AppointmentLinksService } from './appointment-links.service';
import {
  AppointmentLinksController,
  AppointmentPublicController,
} from './appointment-links.controller';
@Module({
  imports: [ChatEngineModule],
  controllers: [
    StoreAppointmentsController,
    AppointmentLinksController,
    AppointmentPublicController,
  ],
  providers: [
    AppointmentConfirmationService,
    AppointmentLinksService,
    StoreAppointmentsService,
    AppointmentScheduleService,
  ],
  exports: [StoreAppointmentsService],
})
export class StoreAppointmentsModule {}
