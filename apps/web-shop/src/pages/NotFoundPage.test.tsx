import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import NotFoundPage from './NotFoundPage';

vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"], link[rel="canonical"]').forEach((el) => {
    el.remove();
  });
});

// Hosting ตอบ 200 ให้ทุก path — หน้านี้ต้องบอก crawler เองว่าไม่ใช่หน้าจริง
it('path ที่ไม่มีอยู่ → noindex และ title เป็นหัวข้อของหน้านี้ ไม่ใช่ของหน้าแรก', () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={['/ไม่มีหน้านี้']}>
      <NotFoundPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'ไม่พบหน้านี้' })).toBeInTheDocument();
  expect(document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe('noindex');
  expect(document.title).toBe('ไม่พบหน้านี้ | BESTCHOICE ลพบุรี');

  unmount();
  expect(document.querySelector('meta[name="robots"]')).toBeNull();
});
