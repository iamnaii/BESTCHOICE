import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { gsap, useGSAP } from '@/components/motion/gsap';
import { PhoneShowcase } from './PhoneShowcase';
import { copy, shopInfo } from '@/lib/copy';

// ห้ามซ้ำคำใน h1 (ไม่เช็กบูโร/ดาวน์ 900) — chip มีไม่กี่สล็อต ใช้ขาย claim ที่พาดหัวยังไม่พูดถึง
const HERO_CHIPS = ['ไม่ต้องมีบัตรเครดิต', 'ผ่อนสูงสุด 12 งวด', 'รับประกันร้าน 60 วัน'];

// แหล่งเดียวของพาดหัว = copy.home.heroTitle (บรรทัดที่ 2 เป็นบรรทัดเน้นสีเขียว)
const [HERO_LINE_1, HERO_LINE_2] = copy.home.heroTitle.split('\n');

export function HomeHero() {
  const scope = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (!window.matchMedia) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const intro = gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.85 } });
        intro
          .from('[data-hero-copy]', {
            y: 24,
            opacity: 0,
            stagger: 0.09,
            clearProps: 'opacity,transform',
          })
          .from(
            '[data-hero-visual]',
            { y: 30, opacity: 0, scale: 0.96, clearProps: 'opacity,transform' },
            0.15,
          )
          .from('[data-hero-badge]', { y: 12, opacity: 0, clearProps: 'opacity,transform' }, 0.5);
      });
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
      className="relative overflow-hidden bg-muted"
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
              <span className="text-primary">{HERO_LINE_2}</span>
            </h1>
            <p
              data-hero-copy
              className="text-base md:text-lg text-muted-foreground max-w-md leading-snug"
            >
              {copy.home.heroDescription}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              {/* The one orange CTA on the page — chat converts (guide rule 2). */}
              <Button asChild size="lg" variant="cta">
                <a href={shopInfo.lineUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4.5" aria-hidden="true" /> ทักแชทเช็คราคา
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-2 border-primary text-primary hover:bg-accent"
              >
                <Link to="/products">
                  ดูรุ่นทั้งหมด <ArrowRight className="size-4.5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <div data-hero-copy className="flex flex-wrap gap-2">
              {HERO_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-card border border-border px-3 py-1 font-head text-[13px] font-medium text-accent-foreground leading-snug"
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
