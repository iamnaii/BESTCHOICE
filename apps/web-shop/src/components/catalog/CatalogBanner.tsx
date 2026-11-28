import { useEffect, useRef, type CSSProperties } from 'react';
import { Check } from '@/lib/icons';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { heroPhoneFallback, heroPhoneSrcSet } from '@/components/hero/hero-phone-images';
import { downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';
import { copy } from '@/lib/copy';
import { CATALOG_PHONE } from './catalog-banner-images';
import './catalog-banner.css';

const { front, back } = CATALOG_PHONE;

// ความกว้างที่รูปถูกวาดจริงต่อช่วงจอ (ดู catalog-banner.css: ขนาดพื้นที่ภาพ × สัดส่วนของแต่ละเครื่อง)
const FRONT_SIZES = '(min-width: 768px) 99px, (min-width: 640px) 80px, 50px';
const BACK_SIZES = '(min-width: 768px) 91px, (min-width: 640px) 74px, 46px';

// เลื่อนตามเมาส์ (px สูงสุด): เครื่องหน้าขยับมากกว่าเครื่องหลัง ไม่เกิน 10
const FOLLOW = [
  { key: 'front', dx: 10, dy: 6 },
  { key: 'back', dx: 5, dy: 3 },
] as const;

const bannerVars = {
  '--cb-front-ratio': `${front.width} / ${front.height}`,
  '--cb-back-ratio': `${back.width} / ${back.height}`,
  '--cb-glass-inset': front.glass.inset,
  '--cb-glass-radius': front.glass.radius,
} as CSSProperties;

/**
 * แบนเนอร์หัวหน้ารายการสินค้า: ข้อความซ้าย รูป iPhone จริงสองเครื่องขวา (เจ้าของเคาะแบบร่าง 2026-11-27)
 * สองเครื่อง = มือ 1 กับมือ 2 · รุ่นและสีในรูปไม่ได้แปลว่ามีของ
 *
 * ยอดดาวน์ในหัวข้อเปลี่ยนเองตามสต๊อก ใช้ข้อความเดียวกับแถบโปรและส่วนหัวหน้าแรก (useDownFloor):
 * มีเครื่องฟรีดาวน์ = "ดาวน์เริ่ม 0 บาท" · หมด = ดาวน์ต่ำสุดจริง · ยังไม่รู้ = ไม่บอกตัวเลข
 *
 * การเคลื่อนไหว: เข้าจอ / ลอย / แถบแสง เป็น CSS (catalog-banner.css) — ข้อความขึ้นเองแม้สคริปต์มาช้า
 * เลื่อนตามเมาส์เป็น GSAP. ชั้นของการขยับแยกกันคนละ element เพื่อไม่เขียนทับ transform ของกัน:
 *   ตำแหน่ง+มุมเอียง (CSS) › เข้าจอ (CSS) › ตามเมาส์ (GSAP: data-banner-follow) › ลอย (CSS)
 */
export function CatalogBanner() {
  const scope = useRef<HTMLElement>(null);
  const downFloor = useKnownDownFloor();
  const downPhrase = downFloor ? downFloorText(downFloor) : copy.catalog.bannerNoDownLead;

  // หยุดการลอยและแถบแสงเมื่อแบนเนอร์เลื่อนพ้นจอ — ไม่ให้แอนิเมชันวนอยู่หลังฉากตลอดหน้า
  useEffect(() => {
    const el = scope.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      el.toggleAttribute('data-offscreen', !entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useGSAP(
    () => {
      if (!window.matchMedia) return;
      const media = gsap.matchMedia();
      // เฉพาะจอที่มีเมาส์ และผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว
      media.add(
        '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
        () => {
          const root = scope.current;
          if (!root) return;
          const parts = FOLLOW.flatMap((part) => {
            const el = root.querySelector<HTMLElement>(`[data-banner-follow="${part.key}"]`);
            if (!el) return [];
            const to = (prop: string) =>
              gsap.quickTo(el, prop, { duration: 0.52, ease: 'power3.out' });
            return [{ ...part, x: to('x'), y: to('y') }];
          });
          const move = (nx: number, ny: number) => {
            for (const part of parts) {
              part.x(nx * part.dx);
              part.y(ny * part.dy);
            }
          };
          const onMove = (event: PointerEvent) => {
            const rect = root.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
            move(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));
          };
          const onLeave = () => move(0, 0);
          root.addEventListener('pointermove', onMove, { passive: true });
          root.addEventListener('pointerleave', onLeave);
          return () => {
            root.removeEventListener('pointermove', onMove);
            root.removeEventListener('pointerleave', onLeave);
          };
        },
      );
      return () => media.revert();
    },
    { scope },
  );

  return (
    <section
      ref={scope}
      className="catalog-banner"
      aria-labelledby="catalog-banner-title"
      style={bannerVars}
    >
      <div className="catalog-banner__copy">
        {/* ข้อความเป็นตัวหนังสือจริง · แต่ละกลุ่มคำไม่ถูกตัดกลาง — จอแคบขึ้นบรรทัดใหม่ทั้งกลุ่ม */}
        <h1 id="catalog-banner-title" className="catalog-banner__title font-display">
          <span className="catalog-banner__line">
            {copy.catalog.bannerTitle.map((group, i) => (
              <span key={group}>
                {i > 0 && ' '}
                <span className="catalog-banner__nobr">{group}</span>
              </span>
            ))}
          </span>{' '}
          <span className="catalog-banner__line catalog-banner__line--accent">
            <span className="catalog-banner__nobr">{downPhrase}</span>{' '}
            <span className="catalog-banner__nobr">{copy.catalog.bannerMonths}</span>
          </span>
        </h1>
        <ul className="catalog-banner__chips">
          {copy.catalog.bannerChips.map((chip) => (
            <li key={chip} className="catalog-banner__chip">
              <Check aria-hidden="true" />
              {chip}
            </li>
          ))}
        </ul>
      </div>
      <figure className="catalog-banner__stage">
        <div className="catalog-banner__slot catalog-banner__slot--back">
          <div className="catalog-banner__enter">
            <div data-banner-follow="back" className="catalog-banner__layer">
              <div className="catalog-banner__float">
                <img
                  src={heroPhoneFallback(back.sources)}
                  srcSet={heroPhoneSrcSet(back.sources)}
                  sizes={BACK_SIZES}
                  width={back.width}
                  height={back.height}
                  alt={back.alt}
                  decoding="async"
                  className="catalog-banner__photo"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="catalog-banner__slot catalog-banner__slot--front">
          <div className="catalog-banner__enter">
            <div data-banner-follow="front" className="catalog-banner__layer">
              <div className="catalog-banner__float">
                <img
                  src={heroPhoneFallback(front.sources)}
                  srcSet={heroPhoneSrcSet(front.sources)}
                  sizes={FRONT_SIZES}
                  width={front.width}
                  height={front.height}
                  alt={front.alt}
                  fetchPriority="high"
                  className="catalog-banner__photo"
                />
                <span className="catalog-banner__shine" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}
