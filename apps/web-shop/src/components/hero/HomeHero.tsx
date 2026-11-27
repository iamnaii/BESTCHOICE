import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { PhoneShowcase } from './PhoneShowcase';
import { copy, shopInfo } from '@/lib/copy';
import { downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';

// ห้ามซ้ำคำใน h1 (ไม่เช็กบูโร / ดาวน์เริ่ม … / ไม่ต้องมีผู้ค้ำ) — chip มีไม่กี่สล็อต ใช้ขาย claim ที่พาดหัวยังไม่พูดถึง
const HERO_CHIPS = ['ไม่ต้องมีบัตรเครดิต', 'ผ่อนสูงสุด 15 งวด', 'มือสองประกันร้าน 60 วัน'];

// แหล่งเดียวของพาดหัว = copy.home.heroTitle (บรรทัดที่ 2 เป็นบรรทัดเน้นสีเขียว)
const [HERO_LINE_1, HERO_LINE_2] = copy.home.heroTitle.split('\n');

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
      // เดิมจางขึ้นจากโปร่งใส 0.85 วินาที · เหลือแค่มือถือสองเครื่องเอียงตามการเลื่อนบนจอกว้าง
      // (ตกแต่งล้วน ไม่ซ่อนเนื้อหา)
      media.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        gsap.to('[data-phone-back]', {
          y: -28,
          rotation: -16,
          ease: 'none',
          scrollTrigger: {
            trigger: scope.current,
            start: 'top top',
            end: 'bottom top',
            scrub: true,
          },
        });
        gsap.to('[data-phone-front]', {
          y: 18,
          rotation: 13,
          ease: 'none',
          scrollTrigger: {
            trigger: scope.current,
            start: 'top top',
            end: 'bottom top',
            scrub: true,
          },
        });
      });
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
              BESTCHOICE · ร้าน iPhone ลพบุรี
            </p>
            <h1
              id="home-hero-title"
              data-hero-copy
              className="font-display text-3xl lg:text-5xl md:text-4xl font-bold text-foreground leading-[1.35]"
            >
              {HERO_LINE_1}
              <br />
              <span className="text-primary">
                {HERO_LINE_2}{' '}
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
