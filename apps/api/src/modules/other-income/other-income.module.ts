import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { StorageModule } from '../storage/storage.module';
import { OtherIncomeService } from './other-income.service';
import { OtherIncomeController } from './other-income.controller';
import { DocNumberService } from './services/doc-number.service';
import { ValidationService } from './services/validation.service';
import { AutoJournalService } from './services/auto-journal.service';
import { TemplateService } from './services/template.service';
import { OtherIncomeTemplate } from './templates/other-income.template';

// PrismaService is provided globally via PrismaModule (@Global) — no import needed.

@Module({
  imports: [JournalModule, StorageModule],
  controllers: [OtherIncomeController],
  providers: [
    OtherIncomeService,
    DocNumberService,
    ValidationService,
    AutoJournalService,
    TemplateService,
    OtherIncomeTemplate,
  ],
  exports: [OtherIncomeService, TemplateService],
})
export class OtherIncomeModule {}
