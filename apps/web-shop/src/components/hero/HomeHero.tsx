import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { media } from '@/lib/media-placeholders';
import { Reveal } from '@/components/motion/Reveal';
import { shopInfo } from '@/lib/copy';

const HERO_CHIPS = ['ไม่ต้องมีบัตรเครดิต', 'ไม่เช็กบูโร', 'รับประกันร้าน 60 วัน'];

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-muted">
      {/* Decorative brand-gradient tile, rotated off the top-right corner —
          the guide's hero signature. Never carries text. */}
      <div
        aria-hidden
        className="absolute -right-16 -top-16 size-64 rounded-[40px] bg-brand-gradient rotate-[18deg] opacity-90 pointer-events-none"
      />
      <Container>
        <div className="relative grid md:grid-cols-2 gap-8 items-center py-10 md:py-16">
          <Reveal>
            <div className="space-y-5">
              <h1 className="font-display text-3xl md:text-5xl font-bold text-foreground leading-[1.3]">
                ผ่อน iPhone ใช้บัตรประชาชนใบเดียว
                <br />
                <span className="text-primary">ไม่เช็กบูโร ดาวน์เริ่ม 900 บาท</span>
              </h1>
              <p className="text-base md:text-lg text-zinc-700 max-w-md">
                ร้านมือถือลพบุรี ของแท้ 100% ผ่อนได้ทุกอาชีพ รับเครื่องวันนี้ ตรวจสอบ 30
                จุดก่อนส่งมอบ
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                {/* The one orange CTA on the page — chat converts (guide rule 2). */}
                <Button asChild size="lg" variant="cta">
                  <a href={shopInfo.lineUrl} target="_blank" rel="noopener">
                    <MessageCircle className="size-4.5" /> ทักแชทเช็คราคา
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-2 border-primary text-primary hover:bg-emerald-50">
                  <Link to="/products">
                    ดูรุ่นทั้งหมด <ArrowRight className="size-4.5" />
                  </Link>
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {HERO_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full bg-white border border-border px-3 py-1 font-head text-[13px] font-medium text-accent-foreground leading-snug"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal className="hidden md:block">
            <img
              src={media('hero.home')}
              alt="ร้าน BESTCHOICE ลพบุรี"
              className="rounded-3xl shadow-xl w-full object-cover aspect-square bg-background"
              loading="eager"
            />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
