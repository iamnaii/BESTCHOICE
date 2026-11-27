/**
 * รูปเครื่องในส่วนหัวหน้าแรก — แหล่งเดียวของไฟล์รูป ขนาด และตำแหน่งหน้าจอบนรูปด้านหน้า
 *
 * ที่มาของรูป: ภาพสินค้า iPhone ของผู้ผลิต ตัดพื้นหลังจากหน้าสินค้าของตัวแทนจำหน่าย —
 * เจ้าของเลือกใช้ขึ้นเว็บจริง (2026-11-27) แทนรูปถ่ายของร้าน และรับความเสี่ยงเรื่องสิทธิ์ภาพเอง.
 * จอในรูปด้านหน้าถูกถมดำแล้ว หน้าจอที่เห็นบนเว็บเป็นหน้าจอแบรนด์ที่วาดทับใน PhoneShowcase.
 * ไฟล์ต้นทางกว้างสุด 344 px (เครื่องหน้า) / 262 px (เครื่องหลัง) จึงมีแค่สองขนาดนี้.
 *
 * เปลี่ยนเป็นรูปถ่ายของร้านทีหลัง: วางไฟล์ WebP สองขนาดต่อด้านใน src/assets/hero/
 * (แนะนำกว้าง 344 และ 688 px) แล้วแก้ import + ตัวเลขในไฟล์นี้ไฟล์เดียว:
 * - width/height = ขนาดจริงของรูปใหญ่ (ใช้กันเลย์เอาต์กระตุก)
 * - screen/island = ตำแหน่งจอและช่องกล้องหน้าบนรูปด้านหน้า หน่วยเป็น % ของรูป (วัดใหม่ทุกครั้งที่เปลี่ยนรูป)
 */
// ?no-inline: ให้ทุกรูปเป็นไฟล์เสมอ — Vite ฝังไฟล์ที่เล็กกว่า 4 KB ลงใน JS ซึ่งทำให้รูปหลักมาช้ากว่า JS
import backSm from '@/assets/hero/hero-phone-back-184.webp?no-inline';
import backLg from '@/assets/hero/hero-phone-back-262.webp?no-inline';
import frontSm from '@/assets/hero/hero-phone-front-240.webp?no-inline';
import frontLg from '@/assets/hero/hero-phone-front-344.webp?no-inline';

type Source = { src: string; w: number };

export const HERO_PHONE = {
  front: {
    width: 344,
    height: 710,
    sources: [
      { src: frontSm, w: 240 },
      { src: frontLg, w: 344 },
    ],
    /** ขอบจอวัดจากขอบรูป (บน ขวา ล่าง ซ้าย) และรัศมีมุมจอ */
    screen: { inset: '1.4% 4.05% 1.5% 3.5%', radius: '15.1% / 7%' },
    /** ช่องกล้องหน้า วัดจากกรอบจอ */
    island: { left: '39.3%', top: '1.5%', width: '21.5%', height: '3.8%' },
  },
  back: {
    width: 262,
    height: 540,
    sources: [
      { src: backSm, w: 184 },
      { src: backLg, w: 262 },
    ],
  },
} as const;

export function heroPhoneSrcSet(sources: readonly Source[]): string {
  return sources.map((s) => `${s.src} ${s.w}w`).join(', ');
}

/** รูปที่ใช้เมื่อเบราว์เซอร์ไม่รองรับ srcset = รูปใหญ่สุด */
export function heroPhoneFallback(sources: readonly Source[]): string {
  return sources[sources.length - 1].src;
}
