import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ShopUploadController } from './shop-upload.controller';
import { VoiceMemoRestoreController } from './voice-memo-restore.controller';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [ShopUploadController, VoiceMemoRestoreController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
