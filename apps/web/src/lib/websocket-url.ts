import { API_URL } from '@/lib/env';

export function getWsBaseUrl(): string {
  // If API_URL is absolute (e.g. https://api.example.com/api), use its origin
  if (API_URL.startsWith('http')) {
    return new URL(API_URL).origin;
  }
  // API_URL เป็น path สัมพัทธ์ทั้ง dev และ prod — เดิมตกไป localhost:3000 บน prod ⇒ socket ต่อไม่ติด
  // เสียง/แจ้งเตือน/typing ไม่เคยทำงานเลย (สเปก §9.4 แก้ไข 2026-09-05) · prod: API อยู่ origin เดียวกับหน้าเว็บ
  // และ gateway allowlist มีโดเมนนั้นอยู่แล้ว · dev: API แยกพอร์ต 3000 · VITE_WS_URL ยัง override ได้ทั้งคู่
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (import.meta.env.DEV) return 'http://localhost:3000';
  // prod: หน้าเว็บอยู่บน Firebase Hosting ซึ่ง rewrite ได้แค่ HTTP /api/** — WebSocket ต้องไปที่ API โดยตรง
  // (ไม่งั้น handshake ตกไป index.html → inbox ขึ้น "ออฟไลน์" ตลอด 2026-09-06)
  if (
    typeof window !== 'undefined' &&
    /(^|\.)bestchoicephone\.app$/.test(window.location.hostname)
  ) {
    return 'https://api.bestchoicephone.app';
  }
  return window.location.origin;
}
