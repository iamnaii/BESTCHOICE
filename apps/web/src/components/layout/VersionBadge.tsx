import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Format BUILD_TIME (ISO) as Asia/Bangkok local date+time.
const formatBuildTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

interface VersionBadgeProps {
  className?: string;
  variant?: 'sidebar' | 'login';
}

/**
 * Subtle version label injected at build time via vite define.
 * Format: `v26.5.1` with tooltip "Built {date} · {commit}".
 * Bumped manually in `apps/web/package.json` before each deploy.
 * GIT_COMMIT is set by CI from `${{ github.sha }}`, "dev" locally.
 */
export function VersionBadge({ className, variant = 'sidebar' }: VersionBadgeProps) {
  const version = __APP_VERSION__;
  const commit = __GIT_COMMIT__;
  const builtAt = formatBuildTime(__BUILD_TIME__);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex select-none items-center text-[11px] font-mono tabular-nums leading-none',
              variant === 'sidebar'
                ? 'text-muted-foreground/60 hover:text-muted-foreground'
                : 'text-muted-foreground/70',
              className,
            )}
            aria-label={`เวอร์ชัน ${version}`}
          >
            v{version}
            {commit !== 'dev' && (
              <span className="ml-1 text-muted-foreground/50">·{commit}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={variant === 'sidebar' ? 'top' : 'top'}
          className="text-[12px] leading-snug"
        >
          <div className="space-y-0.5">
            <div>
              <span className="text-muted-foreground">Version:</span> {version}
            </div>
            <div>
              <span className="text-muted-foreground">Built:</span> {builtAt}
            </div>
            <div>
              <span className="text-muted-foreground">Commit:</span> {commit}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
