/**
 * รูปเครื่องในแบนเนอร์หน้ารายการสินค้า — แหล่งเดียวของไฟล์รูป ขนาด และกรอบกระจกหน้าจอของเครื่องหน้า
 *
 * ที่มาของรูป (เจ้าของเคาะ 2026-11-27 และรับความเสี่ยงเรื่องสิทธิ์ภาพเอง): ภาพสินค้าจากหน้าซื้อ iPhone
 * บน apple.com/th — ตัวเครื่องไม่ถูกดัดแปลง (ไม่เปลี่ยนสี ไม่บิดสัดส่วน ไม่ตัดบางส่วนออก) ทำแค่ตัดพื้นหลัง
 * - เครื่องหน้า: iPhone 16 สีชมพู ด้านหน้า · https://www.apple.com/th/shop/buy-iphone/iphone-16
 *   (iphone-16-pink-select-202409 · ตัวเครื่องในต้นฉบับกว้าง 1,479 px)
 * - เครื่องหลัง: iPhone 17 สีเขียวเซจ ด้านหลัง · https://www.apple.com/th/shop/buy-iphone/iphone-17
 *   (iphone-17-finish-unselect-gallery-3-202509 · ตัวเครื่องในต้นฉบับกว้าง 774 px — ใหญ่สุดที่มีแบบเครื่องเดี่ยวเต็มตัว)
 *
 * เปลี่ยนรูป: วางไฟล์ WebP สองขนาดต่อด้านใน src/assets/catalog/ แล้วแก้ import + ตัวเลขในไฟล์นี้ไฟล์เดียว
 * - width/height = ขนาดจริงของรูปใหญ่ (ใช้จองพื้นที่ กันเลย์เอาต์กระตุก)
 * - glass = กรอบกระจกหน้าจอบนรูปด้านหน้า หน่วยเป็น % ของรูป (แถบแสงวิ่งอยู่ในกรอบนี้ วัดใหม่ทุกครั้งที่เปลี่ยนรูป)
 */
// ?no-inline: ให้ทุกรูปเป็นไฟล์เสมอ — Vite ฝังไฟล์ที่เล็กกว่า 4 KB ลงใน JS ซึ่งทำให้รูปมาช้ากว่า JS
import backSm from '@/assets/catalog/catalog-phone-back-150.webp?no-inline';
import backLg from '@/assets/catalog/catalog-phone-back-300.webp?no-inline';
import frontSm from '@/assets/catalog/catalog-phone-front-160.webp?no-inline';
import frontLg from '@/assets/catalog/catalog-phone-front-320.webp?no-inline';

export const CATALOG_PHONE = {
  front: {
    width: 320,
    height: 648,
    alt: 'iPhone 16 สีชมพู ด้านหน้า',
    sources: [
      { src: frontSm, w: 160 },
      { src: frontLg, w: 320 },
    ],
    glass: { inset: '0.65% 1.98%', radius: '16.4% / 7.9%' },
  },
  back: {
    width: 300,
    height: 615,
    alt: 'iPhone 17 สีเขียวเซจ ด้านหลัง เห็นกล้องคู่',
    sources: [
      { src: backSm, w: 150 },
      { src: backLg, w: 300 },
    ],
  },
} as const;
