import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: { label: string; to: string };
}

export function EmptyState({ icon, title, description, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 leading-snug">
      {icon && (
        <div className="text-5xl text-zinc-300 mb-4" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-xl font-semibold">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {cta && (
        <Button asChild variant="primary" className="mt-6" size="lg">
          <Link to={cta.to}>{cta.label}</Link>
        </Button>
      )}
    </div>
  );
}
