import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole, type MenuItem, type Zone } from '../menu';
import {
  MENU_ICONS,
  MENU_GROUP_ICONS,
  WORK_ZONE_ICONS,
  getMenuIcon,
} from '../navigation-icons';
import { settingsRegistry } from '../settings-registry';
import { WorkNavigation } from '@/components/layout/WorkNavigation';

const roles = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES', 'VIEWER'];

describe('unique navigation icon identity', () => {
  it('uses distinct SVG geometry for every different destination, group and work selector (including aliases)', () => {
    const shapes = new Map<string, string>();
    for (const [key, Icon] of Object.entries({
      ...MENU_ICONS,
      ...MENU_GROUP_ICONS,
      ...WORK_ZONE_ICONS,
    })) {
      // Ignore the SVG class/name: two icon aliases can name the same drawing.
      const shape = renderToStaticMarkup(createElement(Icon)).replace(/<svg[^>]*>|<\/svg>/g, '');
      expect(shapes.get(shape), `${key} duplicates ${shapes.get(shape)}`).toBeUndefined();
      shapes.set(shape, key);
    }
  });

  it.each(roles)(
    '%s has a mapped icon for every authorized menu, without per-role visual drift',
    (role) => {
      const checkItem = (item: MenuItem) => {
        expect(MENU_ICONS[item.path], `${role}: missing ${item.path}`).toBeDefined();
        expect(item.icon).toBe(MENU_ICONS[item.path]);
        item.children?.forEach(checkItem);
      };
      for (const zone of ['shop', 'fin', 'settings'] as Zone[]) {
        for (const section of getSidebarForRole(role, zone)) {
          const key = `${zone}:${section.label}`;
          expect(MENU_GROUP_ICONS[key], `missing group ${key}`).toBeDefined();
          expect(section.icon).toBe(MENU_GROUP_ICONS[key]);
          section.items.forEach(checkItem);
        }
        for (const tab of getZoneConfigForRole(role)?.bottomNav[zone] ?? []) {
          expect(tab.icon).toBe(MENU_ICONS[tab.path]);
          expect(tab.icon).toBeDefined();
        }
      }
    },
  );

  it('keeps settings category and collections alias icons consistent with navigation', () => {
    for (const category of settingsRegistry)
      expect(category.icon).toBe(MENU_ICONS[`/settings/${category.id}`]);
    expect(getMenuIcon('/collections', MENU_ICONS['/'])).toBe(MENU_ICONS['/overdue']);
  });

  it.each(['shop', 'fin'] as const)(
    '%s renders real, decorative icons on every leaf and header',
    (zone) => {
      render(
        <MemoryRouter>
          <WorkNavigation
            zone={zone}
            sections={getSidebarForRole('OWNER', zone)}
            activePath={null}
            renderBadge={() => null}
          />
        </MemoryRouter>,
      );
      const nav = screen.getByRole('navigation');
      const buttons = Array.from(nav.querySelectorAll('button'));
      for (const button of buttons) {
        expect(button.querySelector('svg[data-nav-icon]')).not.toBeNull();
        if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
      }
      for (const link of screen.getAllByRole('link')) {
        const icon = link.querySelector('svg[data-nav-icon]');
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('data-icon-style', 'duotone');
      }
    },
  );
});
