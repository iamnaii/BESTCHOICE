import { Module } from '@nestjs/common';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [TodosController],
  providers: [TodosService],
  exports: [TodosService],
})
export class TodosModule {}
