import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardToolbar,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DataTableCardProps {
  title: string;
  description?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DataTableCard({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ค้นหา...',
  toolbar,
  children,
  className,
}: DataTableCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <CardToolbar>
          <div className="flex items-center gap-2">
            {onSearchChange && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-[200px] pl-8"
                />
              </div>
            )}
            {toolbar}
          </div>
        </CardToolbar>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
