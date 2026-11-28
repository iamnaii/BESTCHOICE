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

// ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 12: ย่อหน้าตอบตรง ๆ ว่าร้านคืออะไร อยู่ไหน เปิดกี่โมง ติดต่อทางไหน
// — ข้อเท็จจริงทุกช่องมาจาก shopInfo ห้ามพิมพ์ซ้ำเอง
// เจ้าของขอให้สั้นลง 28 พ.ย. 2569: ที่อยู่เหลือชื่อถนน และไม่พูดเรื่องผ่อนซ้ำกับส่วนหัว
it('ข้อความแนะนำร้านสั้น และประกอบจาก shopInfo', () => {
  const text = copy.home.shopSummary;
  expect(text).toBe(
    `BESTCHOICE ร้านขาย iPhone มือ 1 และมือ 2 ในลพบุรี อยู่${shopInfo.street} ${shopInfo.hours} ทักไลน์ ${shopInfo.lineHandle} หรือโทร ${shopInfo.phoneDisplay}`,
  );
  // ชื่อถนนเป็นส่วนหนึ่งของที่อยู่เต็มชุดเดียวกัน (ที่อยู่เต็มยังอยู่ในหน้าติดต่อและข้อมูลร้านสำหรับ Google)
  expect(shopInfo.address).toContain(shopInfo.street);
  expect(text).not.toContain(shopInfo.address);
  expect(text).not.toContain('ผ่อน');
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

// เจ้าของขอให้สั้นลง 28 พ.ย. 2569: บรรทัดใต้พาดหัวไม่บอก "ร้านมือถือลพบุรี" ซ้ำกับบรรทัดเหนือพาดหัว
it('ข้อความใต้พาดหัวหน้าแรกสั้น ไม่ซ้ำชื่อร้านกับบรรทัดบน', () => {
  expect(copy.home.heroDescription).toBe('ของแท้ 100% ผ่อนได้ทุกอาชีพ รับเครื่องวันนี้');
});

// เจ้าของกำหนดคำเอง 28 พ.ย. 2569
it('บรรทัดเหนือพาดหัวหน้าแรกเขียนว่า BESTCHOICE · ผ่อนไอโฟนลพบุรี', () => {
  get.mockReturnValue(new Promise(() => {}));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('BESTCHOICE · ผ่อนไอโฟนลพบุรี')).toBeInTheDocument();
  // เจ้าของสั่ง 28 พ.ย. 2569: ข้อความบนหน้าแรกใช้ "มือ 1 และมือ 2" (ไม่ใช่ "มือสอง")
  expect(document.body.textContent).not.toContain('มือ 1 และมือสอง');
  expect(document.body.textContent).toContain('มือ 1 และมือ 2');
  expect(screen.queryByText('BESTCHOICE · ร้าน iPhone ลพบุรี')).not.toBeInTheDocument();
});
