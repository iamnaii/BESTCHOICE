import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import {
  AccordionMenu,
  AccordionMenuItem,
  AccordionMenuSub,
  AccordionMenuSubTrigger,
  AccordionMenuSubContent,
} from '@/components/ui/accordion-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { expandedMenuClassNames } from './SidebarMenuItems';
import type { NavSection } from './SidebarMenuItems';

interface SidebarNavGroupProps {
  sections: NavSection[];
  matchPath: (path: string) => boolean;
  selectedValue: string;
}

export function SidebarNavGroup({ sections, matchPath, selectedValue }: SidebarNavGroupProps) {
  return (
    <ScrollArea className="flex-1 py-3 px-3">
      <AccordionMenu
        selectedValue={selectedValue}
        matchPath={matchPath}
        type="multiple"
        classNames={expandedMenuClassNames}
      >
        <AccordionMenuItem value="/" className="text-sm font-medium">
          <Link to="/" className="flex items-center justify-between grow gap-2">
            <Home data-slot="accordion-menu-icon" />
            <span data-slot="accordion-menu-title">หน้าหลัก</span>
          </Link>
        </AccordionMenuItem>

        {sections.map((section) => (
          <AccordionMenuSub key={section.key} value={section.key}>
            <AccordionMenuSubTrigger>
              <section.icon data-slot="accordion-menu-icon" className="size-4" />
              <span data-slot="accordion-menu-title">{section.label}</span>
            </AccordionMenuSubTrigger>
            <AccordionMenuSubContent parentValue={section.key} type="single" collapsible>
              {section.items.map((item) => (
                <AccordionMenuItem key={item.path} value={item.path} className="text-2sm">
                  <Link to={item.path} className="flex items-center gap-2 w-full">
                    {item.icon && <item.icon data-slot="accordion-menu-icon" className="size-4" />}
                    <span data-slot="accordion-menu-title">{item.label}</span>
                  </Link>
                </AccordionMenuItem>
              ))}
            </AccordionMenuSubContent>
          </AccordionMenuSub>
        ))}
      </AccordionMenu>
    </ScrollArea>
  );
}
