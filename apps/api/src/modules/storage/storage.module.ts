import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ShopUploadController } from './shop-upload.controller';
import { VoiceMemoRestoreController } from './voice-memo-restore.controller';
import { VoiceMemoRestoreService } from './voice-memo-restore.service';
import { VoiceMemoRestorePollCron } from './voice-memo-restore-poll.cron';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ShopUploadController, VoiceMemoRestoreController],
  providers: [StorageService, VoiceMemoRestoreService, VoiceMemoRestorePollCron],
  exports: [StorageService, VoiceMemoRestoreService],
})
export class StorageModule {}
