import { Building2, ChevronDown } from 'lucide-react';
import { useEntityScope } from '@/contexts/EntityScopeContext';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Company data scope is independent of the sidebar's work categories. */
export function CompanySwitcher() {
  const { scope, setScope, canSwitch, accessibleCompanies } = useEntityScope();
  const queryClient = useQueryClient();

  if (!canSwitch) return null;

  const handleSwitch = (next: string) => {
    if ((next !== 'SHOP' && next !== 'FINANCE') || next === scope) return;
    setScope(next);
    // Reload using the company parameter attached by the API interceptor.
    queryClient.invalidateQueries();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-11 gap-1.5 px-2 text-xs leading-snug sm:h-9 sm:px-3 sm:text-sm"
          aria-label={`บริษัทที่แสดงข้อมูล: BESTCHOICE ${scope}`}
        >
          <Building2 className="hidden size-3.5 sm:block" aria-hidden="true" />
          <span className="text-left">
            <span className="block text-[10px] text-muted-foreground sm:inline sm:text-sm">
              บริษัท<span className="hidden sm:inline">: </span>
            </span>
            <span>
              <span className="hidden xl:inline">BESTCHOICE </span>
              {scope}
            </span>
          </span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>เลือกบริษัทที่ต้องการดูข้อมูล</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={scope} onValueChange={handleSwitch}>
          {accessibleCompanies.map((company) => (
            <DropdownMenuRadioItem key={company} value={company} className="min-h-11 leading-snug">
              BESTCHOICE {company}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
