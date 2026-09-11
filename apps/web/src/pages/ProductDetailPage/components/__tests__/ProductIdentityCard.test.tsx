import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const copy = vi.fn().mockResolvedValue(true);
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy, copied: false, error: null }),
}));

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

import ProductIdentityCard from '../ProductIdentityCard';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const base = {
  id: 'p1',
  name: 'iPhone 15 128GB Black',
  brand: 'Apple',
  model: 'iPhone 15',
  color: 'Black',
  storage: '128GB',
  imeiSerial: '356789104567890',
  serialNumber: 'F2LX9K7QP0',
  category: 'PHONE_NEW',
  status: 'IN_STOCK',
  batteryHealth: null,
  warrantyExpired: null,
  warrantyExpireDate: null,
  hasBox: null,
  accessoryType: null,
  accessoryBrand: null,
  photos: [] as string[],
  createdAt: '2026-08-27T03:00:00.000Z',
  branch: { id: 'b1', name: 'ลพบุรี' },
  supplier: { id: 's1', name: 'บริษัท ไอเดียโมบาย จำกัด' },
  po: { id: 'po1', poNumber: 'PO-2026-08-041' },
  conditionGrade: null,
  shopWarrantyDays: 7,
  accessoriesIncluded: ['สายชาร์จ', 'เคสใส'],
  cosmeticNotes: null,
};

describe('ProductIdentityCard', () => {
  beforeEach(() => {
    apiGet.mockReset();
    copy.mockClear();
  });

  it('มือถือใหม่: ชื่อรุ่น · ชิปสเปก · IMEI/Serial คัดลอกได้ · ตารางฟิลด์ ช่องว่างเป็น "—"', async () => {
    render(
      <Wrapper>
        <ProductIdentityCard product={base} onGoPhotos={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByRole('heading', { name: 'Apple iPhone 15' })).toBeInTheDocument();
    expect(screen.getByText('128GB')).toBeInTheDocument();
    expect(screen.getByText('มือถือใหม่')).toBeInTheDocument();
    expect(screen.getByText('ประกันร้าน 7 วัน')).toBeInTheDocument();
    expect(screen.getByText('356789104567890')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'คัดลอก IMEI' }));
    expect(copy).toHaveBeenCalledWith('356789104567890');

    expect(screen.getByText('PO-2026-08-041')).toBeInTheDocument();
    expect(screen.getByText('บริษัท ไอเดียโมบาย จำกัด')).toBeInTheDocument();
    // ตำหนิ ไม่มี → "—"
    expect(screen.getByText('ตำหนิ').nextSibling).toHaveTextContent('—');
    // เครื่องใหม่ไม่ยิงรูป 6 มุม
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('มือสอง: แถบรูป 6 มุมจาก /products/:id/photos + ฟิลด์มือสอง (แบต · ประกันศูนย์ · กล่อง · เกรด)', async () => {
    apiGet.mockResolvedValue({
      data: {
        productId: 'p1',
        applicable: true,
        photos: {
          front: 'https://cdn/x/front.jpg',
          back: 'https://cdn/x/back.jpg',
          left: null,
          right: null,
          top: null,
          bottom: null,
        },
      },
    });
    const onGoPhotos = vi.fn();
    render(
      <Wrapper>
        <ProductIdentityCard
          product={{
            ...base,
            category: 'PHONE_USED',
            batteryHealth: 92,
            warrantyExpired: true,
            hasBox: true,
            conditionGrade: 'A',
            cosmeticNotes: 'รอยขนแมวหลังเครื่องเล็กน้อย',
          }}
          onGoPhotos={onGoPhotos}
        />
      </Wrapper>,
    );
    expect(await screen.findByText('รูป 6 มุมจากตอนรับเครื่อง · ครบ 2/6')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'รูปหน้า' })).toHaveAttribute('src', 'https://cdn/x/front.jpg');
    expect(screen.getByText('แบต 92%')).toBeInTheDocument();
    expect(screen.getByText('เกรด A')).toBeInTheDocument();
    expect(screen.getByText('หมดประกันแล้ว')).toBeInTheDocument();
    expect(screen.getByText('มีกล่อง')).toBeInTheDocument();
    expect(screen.getByText('รอยขนแมวหลังเครื่องเล็กน้อย')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /จัดการรูป/ }));
    expect(onGoPhotos).toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledWith('/products/p1/photos');
  });

  it('อุปกรณ์เสริม: ใช้ชุดฟิลด์ของ ACCESSORY (ประเภทอุปกรณ์ · สำหรับยี่ห้อ/รุ่น · ยี่ห้ออุปกรณ์)', () => {
    render(
      <Wrapper>
        <ProductIdentityCard
          product={{
            ...base,
            category: 'ACCESSORY',
            brand: 'Apple',
            model: 'iPhone 15',
            accessoryType: 'เคส',
            accessoryBrand: 'Spigen',
            imeiSerial: null,
            serialNumber: null,
            storage: null,
            color: null,
          }}
          onGoPhotos={vi.fn()}
        />
      </Wrapper>,
    );
    expect(screen.getByText('ประเภทอุปกรณ์')).toBeInTheDocument();
    expect(screen.getByText('เคส')).toBeInTheDocument();
    expect(screen.getByText('ยี่ห้ออุปกรณ์')).toBeInTheDocument();
    expect(screen.getByText('Spigen')).toBeInTheDocument();
    expect(screen.queryByText('IMEI')).toBeNull();
  });
});
