import { Link } from 'react-router';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/layout/Container';
import { media } from '@/lib/media-placeholders';
import { Reveal } from '@/components/motion/Reveal';

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-emerald-50">
      {/* soft background gradient */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          background:
            'radial-gradient(1200px 500px at 20% 0%, rgba(29,180,70,0.15), transparent 60%)',
        }}
      />
      <Container>
        <div className="relative grid md:grid-cols-2 gap-8 items-center py-10 md:py-16">
          <Reveal>
            <div className="space-y-5 leading-snug">
              <h1 className="text-4xl md:text-5xl font-bold text-zinc-900">
                iPhone มือสองคุณภาพ
                <br />
                <span className="text-emerald-600">ผ่อนได้บัตร ปชช. ใบเดียว</span>
              </h1>
              <p className="text-base md:text-lg text-zinc-700 max-w-md">
                ร้านมือถือลพบุรี ของแท้ 100% รับประกันร้าน 30 วัน ตรวจสอบ 30 จุดก่อนส่งมอบ
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button asChild size="lg" variant="primary">
                  <Link to="/products">
                    ดูสินค้าทั้งหมด <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="https://line.me/R/ti/p/@bestchoice" target="_blank" rel="noopener">
                    <MessageCircle className="size-4" /> ทักไลน์
                  </a>
                </Button>
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
