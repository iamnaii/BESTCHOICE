import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Search, X } from '@/lib/icons';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import type { MenuBadgeKey, MenuItem, MenuSection } from '@/config/menu';

interface WorkNavigationProps {
  sections: MenuSection[];
  zone: 'shop' | 'fin';
  activePath: string | null;
  mobile?: boolean;
  onNavigate?: () => void;
  renderBadge: (key: MenuBadgeKey) => ReactNode;
}

export function WorkNavigation({
  sections,
  zone,
  activePath,
  mobile,
  onNavigate,
  renderBadge,
}: WorkNavigationProps) {
  const [query, setQuery] = useState('');
  const search = useDebounce(query.trim().toLocaleLowerCase(), 120);
  const [searchExpansion, setSearchExpansion] = useState<{ query: string; keys: string[] }>({
    query: '',
    keys: [],
  });
  const input = useRef<HTMLInputElement>(null);
  const activeGroup = sections.find((section) =>
    section.items.some(
      (item) =>
        item.path === activePath || item.children?.some((child) => child.path === activePath),
    ),
  )?.key;
  const [open, setOpen] = useState<string[]>(() =>
    sections
      .filter(
        (section) =>
          (zone === 'shop' &&
            (section.key.endsWith('-customers') || section.key.endsWith('-sales'))) ||
          section.key === activeGroup,
      )
      .map((section) => section.key),
  );
  useEffect(() => {
    if (activeGroup)
      setOpen((previous) =>
        previous.includes(activeGroup) ? previous : [...previous, activeGroup],
      );
  }, [activeGroup]);

  const sale =
    zone === 'shop'
      ? sections.flatMap((section) => section.items).find((item) => item.path === '/pos')
      : undefined;
  const filtered = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items
            .filter((item) => item.path !== sale?.path)
            .flatMap((item) => {
              if (
                !search ||
                section.label.includes(search) ||
                item.label.toLocaleLowerCase().includes(search)
              )
                return [item];
              const children = item.children?.filter((child) =>
                child.label.toLocaleLowerCase().includes(search),
              );
              return children?.length ? [{ ...item, children }] : [];
            }),
        }))
        .filter((section) => section.items.length > 0),
    [sections, search, sale?.path],
  );

  const renderLink = (item: MenuItem) => (
    <Link
      key={item.path}
      to={item.path}
      onClick={onNavigate}
      aria-current={item.path === activePath ? 'page' : undefined}
      className={cn(
        'relative flex min-h-9 items-start gap-2.5 rounded-md py-2 px-2.5 text-sm leading-snug text-foreground/75 hover:bg-sidebar-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        mobile && 'min-h-11',
        item.path === activePath &&
          'bg-primary/10 font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r before:bg-primary',
      )}
    >
      <item.icon
        className="size-[18px] shrink-0"
        aria-hidden="true"
        data-nav-icon
      />
      <span className="flex-1">{item.label}</span>
      {item.badgeKey && renderBadge(item.badgeKey)}
    </Link>
  );

  return (
    <>
      <div className="shrink-0 space-y-2.5 px-3 pb-2 pt-3">
        {sale && (
          <Link
            to={sale.path}
            onClick={onNavigate}
            aria-current={activePath === sale.path ? 'page' : undefined}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold leading-snug text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <sale.icon
              className="size-5"
              aria-hidden="true"
              data-nav-icon
            />
            {sale.label}
            <ArrowUpRight className="ml-auto size-4" aria-hidden="true" />
          </Link>
        )}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            data-work-menu-search
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setQuery('');
              }
            }}
            aria-label={zone === 'shop' ? 'ค้นหาเมนูหน้าร้าน' : 'ค้นหาเมนูการเงิน'}
            placeholder="ค้นหาเมนู..."
            className="h-11 pl-9 pr-11 text-sm"
          />
          {query && (
            <button
              type="button"
              aria-label="ล้างคำค้นเมนู"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
              className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        <nav aria-label={zone === 'shop' ? 'เมนูงานหน้าร้าน' : 'เมนูงานการเงิน'}>
          <Accordion
            type="multiple"
            value={
              search
                ? searchExpansion.query === search
                  ? searchExpansion.keys
                  : filtered.map((section) => section.key)
                : open
            }
            onValueChange={(keys) =>
              search ? setSearchExpansion({ query: search, keys }) : setOpen(keys)
            }
          >
            {filtered.map((section) => (
              <AccordionItem
                key={section.key}
                value={section.key}
                data-testid={`nav-${mobile ? 'mobile-' : ''}${section.key}`}
                className="border-sidebar-border/60 last:border-0"
              >
                <AccordionTrigger className="min-h-11 gap-2 rounded-md px-2 py-2 text-[13px] font-semibold leading-snug text-foreground/85 hover:bg-sidebar-hover hover:no-underline">
                  <span className="flex items-center gap-2.5">
                    <section.icon
                      className="size-5 shrink-0 text-muted-foreground"
                      data-nav-icon
                      aria-hidden="true"
                    />
                    {section.label}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-2 pl-4">
                  {section.items.map((item) =>
                    item.children?.length ? (
                      <div key={item.path}>
                        <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">
                          {item.label}
                        </p>
                        {item.children.map(renderLink)}
                      </div>
                    ) : (
                      renderLink(item)
                    ),
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {filtered.length === 0 && (
            <p
              role="status"
              className="px-3 py-6 text-center text-sm leading-relaxed text-muted-foreground"
            >
              {sale && sale.label.includes(search)
                ? 'เปิดขายสินค้าได้จากปุ่มด้านบน'
                : 'ไม่พบเมนูที่ค้นหา ลองใช้คำค้นอื่น'}
            </p>
          )}
        </nav>
      </ScrollArea>
    </>
  );
}
