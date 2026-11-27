import { Container } from '@/components/layout/Container';
import { shopInfo } from '@/lib/copy';

/**
 * ช่องรูปจริงใต้หัวข้อของหน้า SEO สามหน้า (เจ้าของ 2026-11-27 ส่วน B7):
 * รูปหน้าร้าน 1 รูป + รูปลูกค้ารับเครื่อง 3 รูป · เจ้าของร้านใส่ URL ที่ `shopInfo.storePhotoUrl`
 * และ `shopInfo.customerPhotoUrls` · ยังไม่มีรูป = ไม่แสดงอะไร (ไม่มีกรอบว่างหรือรูปตัวอย่างขึ้นเว็บ)
 */
export function StorePhotos() {
  const store = shopInfo.storePhotoUrl;
  const customers = shopInfo.customerPhotoUrls.slice(0, 3);
  if (!store && customers.length === 0) return null;
  return (
    <Container>
      <div className="space-y-3 pt-6">
        {store && (
          <img
            src={store}
            alt="หน้าร้าน BESTCHOICE ลพบุรี ถนนนารายณ์มหาราช"
            className="aspect-video w-full rounded-2xl object-cover"
            loading="eager"
            decoding="async"
          />
        )}
        {customers.length > 0 && (
          <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="ลูกค้ารับเครื่องที่ร้าน">
            {customers.map((src, i) => (
              <li key={src}>
                <img
                  src={src}
                  alt={`ลูกค้ารับเครื่องที่ร้าน BESTCHOICE รูปที่ ${i + 1}`}
                  className="aspect-square w-full rounded-xl object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}
