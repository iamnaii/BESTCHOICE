import { Container } from '@/components/layout/Container';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router';
import { Reveal } from '@/components/motion/Reveal';

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
}
interface Props {
  eyebrow?: string;
  title: string;
  description: string;
  cta: { label: string; to: string };
  steps?: Step[];
}

export function LandingHero({ eyebrow, title, description, cta, steps }: Props) {
  return (
    <section className="bg-gradient-to-b from-emerald-50 to-background">
      <Container>
        <div className="py-10 md:py-16 space-y-10 leading-snug">
          <Reveal>
            <div className="space-y-4 text-center md:text-left max-w-2xl">
              {eyebrow && (
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  {eyebrow}
                </span>
              )}
              <h1 className="text-3xl md:text-4xl font-bold">{title}</h1>
              <p className="text-base md:text-lg text-muted-foreground">{description}</p>
              <Button asChild size="lg" variant="primary">
                <Link to={cta.to}>{cta.label}</Link>
              </Button>
            </div>
          </Reveal>
          {steps && (
            <div className="grid md:grid-cols-3 gap-4">
              {steps.map((s, i) => (
                <Reveal key={i}>
                  <div className="rounded-2xl bg-card border border-zinc-200 p-4 shadow-sm space-y-2">
                    <div className="text-emerald-500">{s.icon}</div>
                    <div className="font-semibold">{s.title}</div>
                    <p className="text-sm text-muted-foreground">{s.description}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
