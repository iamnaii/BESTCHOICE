import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ProductGallery } from '@/components/catalog/ProductGallery';
import ShopFooter from '@/components/layout/ShopFooter';
import { Button, ButtonArrow } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import {
  BadgeCheck,
  BatteryCharging,
  Compass,
  Expand,
  FacebookLogo,
  Share2,
  TiktokLogo,
} from './icons';

describe('storefront icons', () => {
  it.each([
    ['verified badge', BadgeCheck, 'M232,128c0,12.51-17.82,21.95-22.68,33.69'],
    ['charging battery', BatteryCharging, 'M216,80v96a16,16,0,0,1-16,16H32'],
    ['compass', Compass, 'M128,32a96,96,0,1,0,96,96'],
    ['expand', Expand, 'M208,48V208H48V48Z'],
    ['share', Share2, 'M208,200a32,32,0,1,1-32-32'],
    ['Facebook', FacebookLogo, 'M224,128a96,96,0,1,1-96-96'],
    ['TikTok', TiktokLogo, 'M224,120a95.55,95.55,0,0,1-56-18v54'],
  ] as const)('renders the %s glyph in duotone at the requested size', (name, Icon, pathStart) => {
    render(<Icon role="img" aria-label={name} size={20} />);
    const svg = screen.getByRole('img', { name });
    expect(svg).toHaveAttribute('data-icon-style', 'duotone');
    expect(svg).toHaveAttribute('viewBox', '0 0 256 256');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg.querySelector('path[opacity="0.2"]')?.getAttribute('d')).toEqual(
      expect.stringContaining(pathStart),
    );
  });

  it.each([
    ['Facebook', 'facebook-logo', 'https://www.facebook.com/bestchoicelopburi'],
    ['TikTok', 'tiktok-logo', 'https://www.tiktok.com/@bestchoicelopburi'],
  ])('keeps the %s footer link named and renders its brand glyph', (label, glyph, href) => {
    render(
      <MemoryRouter>
        <ShopFooter />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: label });
    expect(link).toHaveAttribute('href', href);
    expect(link.querySelector(`svg.app-icon-${glyph}`)).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves the native select label and disabled state with a decorative caret', () => {
    const { container } = render(
      <NativeSelect aria-label="สาขา" disabled defaultValue="branch">
        <option value="branch">สาขาทดสอบ</option>
      </NativeSelect>,
    );
    expect(screen.getByRole('combobox', { name: 'สาขา' })).toBeDisabled();
    expect(container.querySelector('svg.app-icon-caret-down')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('renders a decorative loading spinner and accepts an app icon as the button arrow', () => {
    render(
      <Button loading disabled>
        กำลังโหลด
        <ButtonArrow icon={Expand} aria-hidden="true" />
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'กำลังโหลด' });
    expect(button).toBeDisabled();
    const spinner = button.querySelector('svg.app-icon-spinner-gap');
    expect(spinner).toHaveClass('animate-spin');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('svg[data-slot="button-arrow"]')).toHaveClass(
      'app-icon-arrows-out',
    );
  });

  it('keeps the Radix close button accessible and working', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>รายละเอียด</DialogTitle>
          <DialogDescription>รายละเอียดทดสอบ</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'รายละเอียด' });
    const close = within(dialog).getByRole('button', { name: 'ปิด' });
    expect(close.querySelector('svg.app-icon-x')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the expand glyph on the named gallery control', async () => {
    render(<ProductGallery images={['/front.jpg']} alt="iPhone 13" />);
    const expand = screen.getByRole('button', { name: 'ดูรูปขยาย' });
    expect(expand.querySelector('svg.app-icon-arrows-out')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(expand);
    expect(screen.getByRole('dialog', { name: 'iPhone 13' })).toBeInTheDocument();
  });
});
