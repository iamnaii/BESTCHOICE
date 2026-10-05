import { ChatFollowUpService } from '../staff-chat/services/chat-follow-up.service';
import { ChatWorkAccessService } from '../staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../staff-chat/services/staff-inbox.service';
import { Module } from '@nestjs/common';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [TodosController],
  providers: [TodosService, ChatFollowUpService, ChatWorkAccessService, StaffInboxService],
  exports: [TodosService],
})
export class TodosModule {}
