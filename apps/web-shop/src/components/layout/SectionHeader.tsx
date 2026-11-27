import { ArrowRight } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { Link } from 'react-router';

interface Props {
  title: string;
  description?: string;
  cta?: { label: string; to: string };
  align?: 'left' | 'center';
  className?: string;
  /** `h1` เมื่อเป็นหัวข้อบนสุดของหน้า (หน้าละหนึ่งตัว) — หน้าตาเหมือนกันทุกระดับ */
  as?: 'h1' | 'h2';
}

export function SectionHeader({
  title,
  description,
  cta,
  align = 'left',
  className,
  as: Heading = 'h2',
}: Props) {
  return (
    <div
      className={cn(
        'mb-6 md:mb-8 flex flex-wrap gap-4',
        align === 'center' ? 'flex-col items-center text-center' : 'items-end justify-between',
        className,
      )}
    >
      <div className="space-y-1">
        <Heading className="text-2xl md:text-3xl font-bold leading-snug">{title}</Heading>
        {description && (
          <p className="text-base text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {cta && (
        <Link
          to={cta.to}
          className="text-sm font-medium text-primary hover:text-navy-900 leading-snug whitespace-nowrap"
        >
          {cta.label}{' '}<ArrowRight className="inline size-4 align-text-bottom" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
