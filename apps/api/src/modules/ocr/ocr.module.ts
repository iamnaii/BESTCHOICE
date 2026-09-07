import { Module } from '@nestjs/common';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RoomCreditService } from '../credit-check/services/room-credit.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [OcrController],
  providers: [OcrService, RoomCreditService],
  exports: [OcrService, RoomCreditService],
})
export class OcrModule {}
