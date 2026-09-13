/**
 * แจ้งเตือนข้อความแชทใหม่ของอินบ็อกซ์
 *
 * 🔴 ห้ามใช้ `new Notification(...)` ตรง ๆ บนเส้นทางหลัก — Chrome บน Android โยน
 * `TypeError: Illegal constructor` (บังคับให้ใช้ `ServiceWorkerRegistration.showNotification`)
 * และ iOS Safari ไม่มี `Notification` ใน window เลย ⇒ เดิมแจ้งเตือนบนมือถือไม่เคยเด้งสักครั้ง
 * ทั้งที่ทีมแอดมินตอบลูกค้าจากโทรศัพท์เป็นหลัก
 *
 * ลำดับที่ลอง: service worker ที่ลงทะเบียนอยู่แล้ว (`/sw.js`) → `new Notification` เฉพาะ
 * desktop ที่ไม่มี SW (ครอบ try/catch เผื่อเบราว์เซอร์ที่ห้าม constructor)
 *
 * ขอบเขตที่ต้องรู้: ตัวนี้เด้งได้เมื่อหน้าเว็บ/แอปที่ติดตั้งยังมีชีวิตอยู่ (เปิดค้าง หรือพับไว้เบื้องหลัง)
 * ถ้าปิดแอปไปแล้วหรือระบบฆ่าทิ้ง ต้องใช้ Web Push ที่ส่งจากเซิร์ฟเวอร์ ซึ่งยังไม่มีในระบบ
 */

export type NotifyOutcome = 'sw' | 'window' | 'unsupported' | 'not-granted' | 'failed';

export interface ChatNotificationInput {
  roomId: string;
  text?: string | null;
}

export async function showChatNotification(input: ChatNotificationInput): Promise<NotifyOutcome> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'granted') return 'not-granted';

  const title = 'ข้อความใหม่ — BESTCHOICE';
  const options: NotificationOptions = {
    body: input.text?.substring(0, 100) || 'มีข้อความใหม่',
    icon: '/logo-icon.svg',
    // tag เดียวต่อห้อง — ข้อความรัว ๆ จากลูกค้าคนเดียวจะทับใบเดิม ไม่กองเต็มหน้าจอ
    tag: `chat-${input.roomId}`,
    // ให้ sw.js รู้ว่าแตะแล้วต้องพาไปห้องไหน
    data: { roomId: input.roomId },
  };

  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      await reg.showNotification(title, options);
      return 'sw';
    }
  } catch {
    // ตกไปลองทางหน้าต่างด้านล่าง
  }

  try {
    new Notification(title, options);
    return 'window';
  } catch {
    return 'failed';
  }
}

/**
 * ขอสิทธิ์แจ้งเตือนถ้ายังไม่เคยถาม — ต้องเรียกจาก user gesture เท่านั้น (เบราว์เซอร์ปฏิเสธถ้าไม่ใช่)
 *
 * เดิมขอเฉพาะตอนกด "เปิดเสียง" จากสถานะปิดอยู่ ⇒ ผู้ใช้ที่เสียงเปิดอยู่แล้วตั้งแต่แรก (ค่าเริ่มต้น)
 * **ไม่มีวันถูกขอสิทธิ์เลย** และแจ้งเตือนจึงไม่เคยทำงานสำหรับคนส่วนใหญ่
 */
export function requestNotificationPermissionIfNeeded(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  void Notification.requestPermission().catch(() => {});
}
