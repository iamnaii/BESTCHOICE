import { useEffect, useRef, type CSSProperties } from 'react';
import { ShieldCheck } from '@/lib/icons';
import { HERO_PHONE, heroPhoneFallback, heroPhoneSrcSet } from './hero-phone-images';
import './phone-showcase.css';

// ความกว้างที่รูปถูกวาดจริงต่อช่วงจอ (เครื่องหน้า ≈ 46% ของกล่องภาพ เครื่องหลัง ≈ 40%)
const FRONT_SIZES = '(min-width: 1200px) 260px, (min-width: 768px) 22vw, 165px';
const BACK_SIZES = '(min-width: 1200px) 224px, (min-width: 768px) 19vw, 142px';

const { front, back } = HERO_PHONE;

const showcaseVars = {
  '--ps-front-ratio': `${front.width} / ${front.height}`,
  '--ps-back-ratio': `${back.width} / ${back.height}`,
  '--ps-screen-inset': front.screen.inset,
  '--ps-screen-radius': front.screen.radius,
  '--ps-island-left': front.island.left,
  '--ps-island-top': front.island.top,
  '--ps-island-width': front.island.width,
  '--ps-island-height': front.island.height,
} as CSSProperties;

/**
 * ภาพส่วนหัวหน้าแรก: รูปเครื่องด้านหน้าใหญ่หนึ่งเครื่อง มีเครื่องด้านหลังโผล่ครึ่งหนึ่งอยู่ข้างหลัง
 * (เจ้าของเลือกแบบ ข 2026-11-27). รุ่นในรูปไม่ได้แปลว่ามีของหรือได้ยอดดาวน์ตามพาดหัว — คำบรรยายใต้ภาพจึงต้องอยู่.
 *
 * ทุกอย่างเห็นครบตั้งแต่เฟรมแรก (ส่วน B5): การเคลื่อนไหวเริ่มจากสภาพนิ่งที่เห็นครบ ไม่มีอะไรเริ่มจากโปร่งใส.
 * ชั้นของการขยับแยกกันคนละ element เพื่อไม่เขียนทับ transform ของกัน:
 *   ตำแหน่ง+มุมเอียงตั้งต้น (CSS) › เลื่อนหน้า (GSAP ใน HomeHero: data-phone-back / data-phone-front)
 *   › เอียงตามเมาส์ (GSAP: data-phone-tilt) › ลอยขึ้นลง (CSS)
 */
export function PhoneShowcase() {
  const ref = useRef<HTMLElement>(null);

  // หยุดการลอยและแสงเมื่อส่วนหัวเลื่อนพ้นจอ — ไม่ให้แอนิเมชันวนอยู่หลังฉากตลอดหน้า
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      el.toggleAttribute('data-offscreen', !entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <figure
      ref={ref}
      className="phone-showcase"
      aria-label="ภาพประกอบสมาร์ตโฟน BESTCHOICE"
      style={showcaseVars}
    >
      <div className="phone-showcase__halo" aria-hidden="true" />
      <div className="phone-showcase__stage" aria-hidden="true">
        <div className="phone-showcase__ground" />
        <div className="phone-showcase__phone phone-showcase__phone--back">
          <div data-phone-back className="phone-showcase__layer">
            <div data-phone-tilt="back" className="phone-showcase__layer">
              <div className="phone-showcase__float">
                <img
                  src={heroPhoneFallback(back.sources)}
                  srcSet={heroPhoneSrcSet(back.sources)}
                  sizes={BACK_SIZES}
                  width={back.width}
                  height={back.height}
                  alt=""
                  decoding="async"
                  className="phone-showcase__photo"
                />
                <span className="phone-showcase__shine" />
              </div>
            </div>
          </div>
        </div>
        <div className="phone-showcase__phone phone-showcase__phone--front">
          <div data-phone-front className="phone-showcase__layer">
            <div data-phone-tilt="front" className="phone-showcase__layer">
              <div className="phone-showcase__float">
                {/* รูปหลักของส่วนหัว — โหลดก่อนรูปอื่น */}
                <img
                  src={heroPhoneFallback(front.sources)}
                  srcSet={heroPhoneSrcSet(front.sources)}
                  sizes={FRONT_SIZES}
                  width={front.width}
                  height={front.height}
                  alt=""
                  fetchPriority="high"
                  className="phone-showcase__photo"
                />
                {/* หน้าจอแบรนด์ทับจอของรูป — ไม่โชว์หน้าจอ iOS */}
                <div className="phone-showcase__screen">
                  <div className="phone-showcase__island" />
                  <div className="phone-showcase__wordmark">
                    {/* width/height = สัดส่วนของไฟล์ (viewBox 313×281) จองที่ไว้ก่อนโลโก้โหลด */}
                    <img src="/logo-icon.svg" alt="" width={313} height={281} />
                    <span translate="no">
                      BEST
                      <br />
                      CHOICE.
                    </span>
                    <small>เครื่องที่ใช่ ในแบบที่เป็นคุณ</small>
                  </div>
                </div>
                <span className="phone-showcase__shine" />
              </div>
            </div>
          </div>
        </div>
        <div data-hero-badge className="phone-showcase__badge">
          <div data-phone-tilt="badge">
            <div className="phone-showcase__badge-card">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-primary">
                <ShieldCheck className="size-5" />
              </span>
              <div className="text-left leading-snug">
                <strong className="block font-head text-sm text-foreground">
                  ตรวจเช็กก่อนส่งมอบ
                </strong>
                <span className="text-xs text-muted-foreground">เลือกเครื่องได้อย่างสบายใจ</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="phone-showcase__caption">
        ภาพประกอบ · เลือกดูเครื่องจริงในหน้าสินค้า
      </figcaption>
    </figure>
  );
}
