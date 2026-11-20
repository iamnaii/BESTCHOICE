import { ChatDispatchService } from '../../chat-engine/services/chat-dispatch.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { ChatRoomService } from './chat-room.service';
import { StaffChatGateway } from '../../staff-chat/staff-chat.gateway';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../app.module';
import { ChatbotFinanceService } from './chatbot-finance.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { StorageService } from '../../storage/storage.service';

// บูตใน jest ปกติ (ไม่มี .env): strategy JWT ต้องการ secret ตอนสร้าง provider — ค่าใดก็ได้
process.env.JWT_SECRET ??= 'test-jwt-secret-di-boot';
process.env.JWT_REFRESH_SECRET ??= 'test-jwt-refresh-secret-di-boot';

/**
 * Task 44 — โหมด "เก็บเข้า inbox ไม่ตอบอัตโนมัติ" ของบอทการเงินเก็บข้อความผ่าน MessageRouterService ตัวเดียวกับ SHOP
 * (singleton ของ ChatEngineModule ที่ ChatAdaptersModule ลงทะเบียน adapter LINE_FINANCE ไว้ — ใช้ดึงชื่อ/รูปโปรไฟล์)
 * ⇒ บูต AppModule จริงเพื่อปักว่า DI ต่อถึง instance เดียวกัน ไม่ใช่สำเนาที่ไม่มี adapter
 * (precedent: verification.rich-menu-di.spec.ts)
 */
describe('ChatbotFinanceService — DI ในแอปจริง (Task 44)', () => {
  it('ได้ MessageRouterService + StorageService ตัวเดียวกับทั้งแอป', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const svc = moduleRef.get(ChatbotFinanceService, { strict: false }) as unknown as {
        messageRouter: unknown;
        storage: unknown;
      };
      expect(svc.messageRouter).toBe(moduleRef.get(MessageRouterService, { strict: false }));
      expect(svc.storage).toBe(moduleRef.get(StorageService, { strict: false }));
      const dispatch = moduleRef.get(ChatDispatchService, { strict: false });
      for (const token of [RoomManagerService, MessageRouterService, ChatRoomService]) {
        const service = moduleRef.get(token, { strict: false }) as unknown as { dispatch: unknown };
        expect(service.dispatch).toBe(dispatch);
      }
      expect((dispatch as unknown as { gateway: unknown }).gateway).toBe(moduleRef.get(StaffChatGateway, { strict: false }));
    } finally {
      await moduleRef.close();
    }
  }, 180_000);
});
