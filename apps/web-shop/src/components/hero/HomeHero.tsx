import { Fragment, useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { PhoneShowcase } from './PhoneShowcase';
import { copy, shopInfo } from '@/lib/copy';
import { downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';

// ห้ามซ้ำคำใน h1 (ไม่เช็กบูโร / ดาวน์เริ่ม … / ไม่ต้องมีผู้ค้ำ) — chip มีไม่กี่สล็อต ใช้ขาย claim ที่พาดหัวยังไม่พูดถึง
const HERO_CHIPS = ['ไม่ต้องมีบัตรเครดิต', 'ผ่อนสูงสุด 15 งวด', 'มือ 2 ประกันร้าน 60 วัน'];

// เอียงตามเมาส์: องศาสูงสุด (ry/rx) และระยะเลื่อน px (dx/dy) ต่อชิ้น — เครื่องหน้ามากสุด ไม่เกิน 6°
const HERO_TILT = [
  { key: 'front', ry: 6, rx: 5, dx: 14, dy: 10 },
  { key: 'back', ry: 3.5, rx: 3, dx: -8, dy: -6 },
  { key: 'badge', ry: 0, rx: 0, dx: 5, dy: 4 },
] as const;

// แหล่งเดียวของพาดหัว = copy.home.heroTitle (\n = จุดตัดบรรทัด · บรรทัดสุดท้ายเป็นบรรทัดเน้นสี)
const HERO_LINES = copy.home.heroTitle.split('\n');
const HERO_LEAD_LINES = HERO_LINES.slice(0, -1);
const HERO_ACCENT_LINE = HERO_LINES[HERO_LINES.length - 1];

export function HomeHero() {
  const scope = useRef<HTMLElement>(null);
  // ยอดดาวน์ตามสต๊อก (เจ้าของ 2026-11-27 "ใช้หัวพาดกับการ์ด ตามสต๊อค") · ยังไม่รู้ = ข้อความที่ไม่มีตัวเลข
  const downFloor = useKnownDownFloor();
  const heroDownPhrase = downFloor ? downFloorText(downFloor) : copy.home.heroTitleNoDownSuffix;
  useGSAP(
    () => {
      if (!window.matchMedia) return;
      const media = gsap.matchMedia();
      // ไม่มีแอนิเมชันเปิดหน้า (เจ้าของ 2026-11-27 ส่วน B5): พาดหัว/ปุ่ม/รูปต้องเห็นทันที —
      // การเคลื่อนไหวทั้งหมดอยู่ที่ภาพเท่านั้น เริ่มจากสภาพที่เห็นครบ และไม่แตะข้อความ
      // (การลอยและแสงผ่านกระจกเป็น CSS ใน phone-showcase.css)

      // เลื่อนหน้า (จอกว้าง): สองเครื่องแยกจากกันและเอียงเพิ่ม — ค่าเป็นส่วนเพิ่มจากมุมตั้งต้นใน CSS
      media.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        const scrollTrigger = {
          trigger: scope.current,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        };
        gsap.to('[data-phone-back]', { x: -18, y: -28, rotation: -6, ease: 'none', scrollTrigger });
        gsap.to('[data-phone-front]', { x: 8, y: 18, rotation: 3, ease: 'none', scrollTrigger });
      });

      // เอียงตามเมาส์ (จอคอมที่มีเมาส์): ไม่เกิน 6° เครื่องหน้าขยับมากกว่าเครื่องหลัง การ์ดขยับน้อยสุด
      media.add(
        '(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
        () => {
          const root = scope.current;
          if (!root) return;
          const parts = HERO_TILT.flatMap((part) => {
            const el = root.querySelector<HTMLElement>(`[data-phone-tilt="${part.key}"]`);
            if (!el) return [];
            gsap.set(el, { transformPerspective: 900 });
            const to = (prop: string) =>
              gsap.quickTo(el, prop, { duration: 0.6, ease: 'power3.out' });
            return [
              { ...part, rotY: to('rotationY'), rotX: to('rotationX'), x: to('x'), y: to('y') },
            ];
          });
          const move = (nx: number, ny: number) => {
            for (const part of parts) {
              part.rotY(nx * part.ry);
              part.rotX(-ny * part.rx);
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
      className="relative overflow-hidden bg-linear-to-b from-mint-tint to-white"
      aria-labelledby="home-hero-title"
    >
      <Container>
        <div className="relative grid md:grid-cols-2 gap-8 md:gap-10 items-center py-10 md:py-16">
          <div className="space-y-5">
            <p
              data-hero-copy
              className="font-head text-xs font-semibold tracking-wide text-primary leading-snug"
            >
              BESTCHOICE · ผ่อนไอโฟนลพบุรี
            </p>
            <h1
              id="home-hero-title"
              data-hero-copy
              className="font-display text-3xl lg:text-5xl md:text-4xl font-bold text-foreground leading-[1.35]"
            >
              {/* แต่ละบรรทัดเป็นบล็อกของตัวเอง — จุดตัดอยู่ที่ copy ไม่ปล่อยให้เบราว์เซอร์ตัดกลางคำ */}
              {HERO_LEAD_LINES.map((line) => (
                <Fragment key={line}>
                  <span className="block">{line}</span>{' '}
                </Fragment>
              ))}
              {/* text-wrap (ตัดแบบปกติ): ตัวจัดสมดุลของหัวข้อ (index.css) ตัด "บูโร" กลางคำเมื่อบรรทัดนี้ต้องขึ้นสองบรรทัด */}
              <span className="block text-wrap text-primary">
                {HERO_ACCENT_LINE}{' '}
                {/* ยอดดาวน์ไม่ถูกตัดกลางวลี — จอแคบขึ้นบรรทัดใหม่ทั้งวลี ("ดาวน์เริ่ม 1,200 บาท") */}
                <span className="whitespace-nowrap">{heroDownPhrase}</span>
              </span>
            </h1>
            <p
              data-hero-copy
              className="text-base md:text-lg text-muted-foreground max-w-md leading-relaxed"
            >
              {copy.home.heroDescription}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {/* The one orange CTA on the page — chat converts (guide rule 2). */}
              <Button asChild size="lg" variant="cta">
                <a href={shopInfo.lineUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-5" aria-hidden="true" /> ทักแชทเช็คราคา
                </a>
              </Button>
              {/* ปุ่มกด = เขียว (ส่วน A2) */}
              <Button asChild size="lg" variant="primary">
                <Link to="/products">
                  ดูรุ่นทั้งหมด <ArrowRight className="size-5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <div data-hero-copy className="flex flex-wrap gap-2">
              {HERO_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-card border border-border px-3 py-1 font-head text-sm font-medium text-accent-foreground leading-snug"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div data-hero-visual>
            <PhoneShowcase />
          </div>
        </div>
      </Container>
    </section>
  );
}
