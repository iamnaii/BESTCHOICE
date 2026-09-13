import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showChatNotification,
  requestNotificationPermissionIfNeeded,
} from '../chat-notification';

/**
 * แจ้งเตือนข้อความแชทใหม่ต้องเด้งบนมือถือได้
 *
 * เดิมใช้ `new Notification()` ตรง ๆ ซึ่ง Chrome บน Android โยน `Illegal constructor`
 * ⇒ แอดมินที่ตอบจากโทรศัพท์ไม่เคยได้รับแจ้งเตือนเลย
 */

type PermissionState = 'granted' | 'denied' | 'default';

function installNotification(permission: PermissionState, opts: { ctorThrows?: boolean } = {}) {
  const ctor = vi.fn(function NotificationMock() {
    if (opts.ctorThrows) throw new TypeError('Illegal constructor');
  }) as unknown as typeof Notification & { permission: PermissionState; requestPermission: ReturnType<typeof vi.fn> };
  ctor.permission = permission;
  ctor.requestPermission = vi.fn().mockResolvedValue('granted');
  vi.stubGlobal('Notification', ctor);
  return ctor;
}

function installServiceWorker(reg: { showNotification: ReturnType<typeof vi.fn> } | undefined) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue(reg) },
  });
}

describe('showChatNotification', () => {
  const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
    else delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  });

  it('มี service worker → แจ้งผ่าน SW และไม่เรียก new Notification', async () => {
    const ctor = installNotification('granted');
    const showNotification = vi.fn().mockResolvedValue(undefined);
    installServiceWorker({ showNotification });

    const outcome = await showChatNotification({ roomId: 'room-1', text: 'สวัสดีครับ' });

    expect(outcome).toBe('sw');
    expect(showNotification).toHaveBeenCalledWith(
      'ข้อความใหม่ — BESTCHOICE',
      expect.objectContaining({
        body: 'สวัสดีครับ',
        tag: 'chat-room-1',
        data: { roomId: 'room-1' },
      }),
    );
    expect(ctor).not.toHaveBeenCalled();
  });

  it('Chrome Android ที่ constructor โยน error แต่มี SW → ยังเด้งได้', async () => {
    // เคสจริงที่เดิมพัง: ถ้าไปเรียก new Notification ก่อน จะโยนทิ้งทั้งก้อน
    installNotification('granted', { ctorThrows: true });
    const showNotification = vi.fn().mockResolvedValue(undefined);
    installServiceWorker({ showNotification });

    await expect(showChatNotification({ roomId: 'r', text: 'x' })).resolves.toBe('sw');
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('desktop ที่ไม่มี SW → ใช้ new Notification', async () => {
    const ctor = installNotification('granted');
    installServiceWorker(undefined);

    await expect(showChatNotification({ roomId: 'r', text: 'x' })).resolves.toBe('window');
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี SW และ constructor โยน → ไม่ทำให้หน้าเว็บพัง', async () => {
    installNotification('granted', { ctorThrows: true });
    installServiceWorker(undefined);

    await expect(showChatNotification({ roomId: 'r', text: 'x' })).resolves.toBe('failed');
  });

  it('ยังไม่ได้รับอนุญาต → ไม่แจ้ง', async () => {
    installNotification('default');
    const showNotification = vi.fn();
    installServiceWorker({ showNotification });

    await expect(showChatNotification({ roomId: 'r', text: 'x' })).resolves.toBe('not-granted');
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('ข้อความยาวถูกตัดที่ 100 ตัว และข้อความว่างมีคำแทน', async () => {
    installNotification('granted');
    const showNotification = vi.fn().mockResolvedValue(undefined);
    installServiceWorker({ showNotification });

    await showChatNotification({ roomId: 'r', text: 'ก'.repeat(150) });
    expect(showNotification.mock.calls[0][1].body).toHaveLength(100);

    await showChatNotification({ roomId: 'r', text: null });
    expect(showNotification.mock.calls[1][1].body).toBe('มีข้อความใหม่');
  });
});

describe('requestNotificationPermissionIfNeeded', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ยังไม่เคยถาม → ขอสิทธิ์', () => {
    const ctor = installNotification('default');
    requestNotificationPermissionIfNeeded();
    expect(ctor.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('อนุญาตแล้ว หรือปฏิเสธไปแล้ว → ไม่ถามซ้ำ', () => {
    const granted = installNotification('granted');
    requestNotificationPermissionIfNeeded();
    expect(granted.requestPermission).not.toHaveBeenCalled();

    const denied = installNotification('denied');
    requestNotificationPermissionIfNeeded();
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });
});
