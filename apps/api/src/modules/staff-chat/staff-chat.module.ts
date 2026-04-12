import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffChatGateway } from './staff-chat.gateway';
import { StaffChatController } from './staff-chat.controller';
import { StaffMessageService } from './services/staff-message.service';
import { PresenceService } from './services/presence.service';
import { ChatEngineModule } from '../chat-engine/chat-engine.module';

/**
 * StaffChatModule — real-time staff chat interface.
 *
 * Provides:
 * - WebSocket gateway (/chat namespace) for real-time messaging
 * - REST controller for session management (assign, transfer, resolve, tags, notes)
 * - Presence tracking (online staff)
 * - Canned response access
 */
@Module({
  imports: [
    ChatEngineModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [StaffChatController],
  providers: [StaffChatGateway, StaffMessageService, PresenceService],
  exports: [StaffChatGateway, PresenceService],
})
export class StaffChatModule {}
