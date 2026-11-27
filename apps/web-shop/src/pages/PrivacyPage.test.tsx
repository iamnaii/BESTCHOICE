import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import PrivacyPage from './PrivacyPage';
import { useConsentUi } from '@/components/consent/useConsentUi';

vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => useConsentUi.setState({ settingsOpen: false }));

const open = () =>
  render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );

it('names the company and the cookies actually set', () => {
  open();
  expect(screen.getAllByText(/บริษัท เบสท์ช้อยส์โฟน จำกัด/).length).toBeGreaterThan(0);
  for (const name of ['bc_cookie_consent', '_ga', '_fbp']) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
});

it('does not mention uninstalled trackers or unset owner inputs', () => {
  const { container } = open();
  expect(container.textContent).not.toContain('TikTok');
  expect(container.textContent).not.toContain('อีเมล');
  expect(container.textContent).not.toContain('ฉบับที่ 1');
  expect(container.textContent).not.toContain('ข้อมูลการเข้าชมเว็บไซต์:');
  expect(container.textContent).not.toContain('แบบฟอร์มขายหรือเทิร์นเครื่องที่ไม่ได้ทำรายการต่อ:');
  expect(container.textContent).toContain('ข้อมูลบัญชีและคำสั่งซื้อ:');
});

it('opens the cookie settings from the button, which is not consent UI', () => {
  open();
  const btn = screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' });
  expect(btn).not.toHaveAttribute('data-consent-ui');
  fireEvent.click(btn);
  expect(useConsentUi.getState().settingsOpen).toBe(true);
});
