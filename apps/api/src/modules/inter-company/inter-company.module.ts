import { Module } from '@nestjs/common';
import { InterCompanyController } from './inter-company.controller';
import { InterCompanyService } from './inter-company.service';

@Module({
  controllers: [InterCompanyController],
  providers: [InterCompanyService],
  exports: [InterCompanyService],
})
export class InterCompanyModule {}
