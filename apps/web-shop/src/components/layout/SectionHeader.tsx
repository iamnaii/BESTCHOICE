import { cn } from '@/lib/utils';
import { Link } from 'react-router';

interface Props {
  title: string;
  description?: string;
  cta?: { label: string; to: string };
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeader({ title, description, cta, align = 'left', className }: Props) {
  return (
    <div
      className={cn(
        'mb-6 md:mb-8 flex gap-4',
        align === 'center' ? 'flex-col items-center text-center' : 'items-end justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        <h2 className="text-2xl md:text-3xl font-bold leading-snug">{title}</h2>
        {description && (
          <p className="text-sm md:text-base text-muted-foreground leading-snug">{description}</p>
        )}
      </div>
      {cta && (
        <Link
          to={cta.to}
          className="text-sm font-medium text-emerald-600 hover:text-emerald-700 leading-snug whitespace-nowrap"
        >
          {cta.label} →
        </Link>
      )}
    </div>
  );
}
