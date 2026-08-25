import { describe, it, expect } from 'vitest';
import { isPublicPage, shouldSkipLoginRedirect } from './public-routes';

const at = (pathname: string, search = '', hostname = 'bestchoicephone.app') => ({
  hostname,
  pathname,
  search,
});

describe('lib/public-routes', () => {
  describe('isPublicPage — หน้าที่ห้ามยิง /auth/me', () => {
    // ลิงก์ที่ผู้ใช้เปิดจาก "อีเมล" เสมอ ⇒ เป็น cold load ที่ไม่มี session อยู่แล้ว.
    // ถ้าหลุดจากรายการนี้ interceptor จะเด้งไป /login พร้อมทิ้ง token ใน URL
    // = ลิงก์ในอีเมลใช้ไม่ได้เลย (บั๊ก prod 2026-08-25)
    it.each([
      ['/reset-password', '?token=19eb8379'],
      ['/forgot-password', ''],
      ['/register', '?token=19eb8379'],
      ['/privacy', ''],
      ['/privacy/data-deletion', ''],
    ])('ถือว่า %s เป็นหน้าสาธารณะ', (pathname, search) => {
      expect(isPublicPage(at(pathname, search))).toBe(true);
    });

    it.each(['/liff/contract', '/pay/abc123', '/customer-access/abc123', '/verify/abc123'])(
      'ยังคงถือว่า %s เป็นหน้าสาธารณะเหมือนเดิม',
      (pathname) => {
        expect(isPublicPage(at(pathname))).toBe(true);
      },
    );

    it('ถือว่าโดเมนย่อยของลูกค้าเป็นสาธารณะทั้งโดเมน', () => {
      expect(isPublicPage(at('/anything', '', 'customer.bestchoicephone.app'))).toBe(true);
      expect(isPublicPage(at('/anything', '', 'liff.bestchoicephone.app'))).toBe(true);
    });

    it('ถือว่า liff.state redirect เป็นสาธารณะไม่ว่า path จะเป็นอะไร', () => {
      expect(isPublicPage(at('/', '?liff.state=%2Fcontract'))).toBe(true);
    });

    it.each(['/', '/contracts', '/dashboard'])('ไม่ถือว่า %s เป็นหน้าสาธารณะ', (pathname) => {
      expect(isPublicPage(at(pathname))).toBe(false);
    });

    it('ไม่ข้าม /auth/me บนหน้า /login — App.tsx ต้องรู้ว่ามี session อยู่แล้วเพื่อพาไปหน้าแรก', () => {
      expect(isPublicPage(at('/login'))).toBe(false);
    });
  });

  describe('shouldSkipLoginRedirect — หน้าที่เจอ 401 แล้วห้ามเด้งไป /login', () => {
    it.each([
      '/reset-password',
      '/forgot-password',
      '/register',
      '/privacy',
      '/privacy/data-deletion',
    ])('ไม่เด้งออกจาก %s', (pathname) => {
      expect(shouldSkipLoginRedirect(at(pathname))).toBe(true);
    });

    it.each(['/login', '/landing', '/cn/abc123', '/liff/contract', '/pay/abc123'])(
      'ไม่เด้งออกจาก %s เหมือนเดิม',
      (pathname) => {
        expect(shouldSkipLoginRedirect(at(pathname))).toBe(true);
      },
    );

    it.each(['/', '/contracts', '/dashboard'])('ยังเด้ง %s ไป /login ตามเดิม', (pathname) => {
      expect(shouldSkipLoginRedirect(at(pathname))).toBe(false);
    });
  });

  describe('รูปแบบ path ที่เพี้ยนเล็กน้อย', () => {
    it('ยอมรับ trailing slash', () => {
      expect(isPublicPage(at('/reset-password/'))).toBe(true);
    });

    it('ไม่จับ path ที่แค่ขึ้นต้นคล้ายกัน', () => {
      expect(isPublicPage(at('/registers'))).toBe(false);
      expect(isPublicPage(at('/reset-password-admin'))).toBe(false);
    });
  });
});
