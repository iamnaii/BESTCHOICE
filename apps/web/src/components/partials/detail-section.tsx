import { Card, CardHeader, CardTitle, CardContent, CardToolbar } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DetailSectionProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function DetailSection({ title, actions, children, className, noPadding }: DetailSectionProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {actions && <CardToolbar>{actions}</CardToolbar>}
      </CardHeader>
      <CardContent className={cn(noPadding && 'p-0')}>{children}</CardContent>
    </Card>
  );
}
