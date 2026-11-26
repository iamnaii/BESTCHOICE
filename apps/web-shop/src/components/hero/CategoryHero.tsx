import { Link } from 'react-router';
import { ChevronRight } from '@/lib/icons';
import { Container } from '@/components/layout/Container';

interface Breadcrumb {
  label: string;
  to?: string;
}
interface Props {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
}

export function CategoryHero({ title, description, breadcrumbs }: Props) {
  return (
    <section className="bg-muted border-b border-border">
      <Container>
        <div className="py-6 md:py-8 space-y-2 leading-snug">
          {breadcrumbs && (
            <nav className="text-xs text-muted-foreground flex items-center flex-wrap">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {b.to ? (
                    <Link to={b.to} className="hover:text-primary">
                      {b.label}
                    </Link>
                  ) : (
                    <span>{b.label}</span>
                  )}
                  {i < breadcrumbs.length - 1 && <ChevronRight className="size-4" aria-hidden />}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
          {description && (
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl">{description}</p>
          )}
        </div>
      </Container>
    </section>
  );
}
