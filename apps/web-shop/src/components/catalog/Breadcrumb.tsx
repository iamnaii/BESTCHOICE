import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="breadcrumb"
      className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground leading-snug"
    >
      {items.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" aria-hidden />}
          {c.to ? (
            <Link to={c.to} className="hover:text-foreground hover:underline underline-offset-2">
              {c.label}
            </Link>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
