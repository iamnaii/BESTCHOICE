import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { copy, shopInfo } from '@/lib/copy';
import HomePage from './HomePage';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

// ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 12 (เจ้าของเลือกแบบเต็ม 27 พ.ย.): ย่อหน้าตอบตรง ๆ ว่าร้านคืออะไร
// อยู่ไหน เปิดกี่โมง ติดต่อทางไหน — ข้อเท็จจริงทุกช่องมาจาก shopInfo ห้ามพิมพ์ซ้ำเอง
it('ข้อความแนะนำร้านประกอบจาก shopInfo ครบทุกช่อง', () => {
  const text = copy.home.shopSummary;
  expect(text.startsWith('BESTCHOICE ร้านขาย iPhone มือ 1 และมือสองในลพบุรี')).toBe(true);
  for (const fact of [
    shopInfo.address,
    shopInfo.hours,
    shopInfo.lineHandle,
    shopInfo.phoneDisplay,
  ]) {
    expect(text).toContain(fact);
  }
});

it('หน้าแรกแสดงย่อหน้าแนะนำร้าน', () => {
  get.mockReturnValue(new Promise(() => {})); // ข้อมูลยังโหลด — ย่อหน้าต้องขึ้นโดยไม่รอ API
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // ย่อหน้ามี span กันตัดบรรทัด — เทียบข้อความรวมของทั้งย่อหน้า
  const para = screen.getByText(
    (_, el) => el?.tagName === 'P' && el.textContent === copy.home.shopSummary,
  );
  expect(para).toBeInTheDocument();
  // เวลาเปิดและเบอร์โทรอยู่บรรทัดเดียว (จอมือถือเคยตัด "095-567-" / "8887")
  for (const fact of [shopInfo.hours, shopInfo.phoneDisplay]) {
    expect(within(para).getByText(fact)).toHaveClass('whitespace-nowrap');
  }
});
