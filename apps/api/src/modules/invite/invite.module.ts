import { Module } from '@nestjs/common';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [InviteController],
  providers: [InviteService],
  // AuthModule ใช้ตอน forgot-password ของอีเมลที่ถูกเชิญแต่ยังไม่ลงทะเบียน
  // (ทิศทางเดียว: Auth → Invite; InviteModule ไม่ import AuthModule จึงไม่เป็นวงกลม)
  exports: [InviteService],
})
export class InviteModule {}
