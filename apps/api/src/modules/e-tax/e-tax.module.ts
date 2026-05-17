import { Module } from '@nestjs/common';
import { ETaxController } from './e-tax.controller';
import { ETaxService } from './e-tax.service';

@Module({
  controllers: [ETaxController],
  providers: [ETaxService],
  exports: [ETaxService],
})
export class ETaxModule {}
