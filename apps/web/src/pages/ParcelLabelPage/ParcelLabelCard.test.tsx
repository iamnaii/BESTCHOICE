import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ParcelLabelCard from './ParcelLabelCard';
import type { ParcelLabelDraft } from './parcelLabel';

const draft: ParcelLabelDraft = {
  saleId: 's1',
  saleNumber: 'S-20261022-0001',
  recipientName: 'นางสาว สมหญิง ใจดี',
  phone: '0899999999',
  addressLines: '99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี',
  province: 'ลพบุรี',
  postalCode: '15000',
  carrier: 'KERRY',
  note: 'โทรก่อนส่ง',
  cod: 'ไม่มี',
  item: { title: 'Apple iPhone 15 Pro Max 256GB ดำ', imei: '357200606382344', extras: ['เคสใส', 'ฟิล์มกระจก'] },
  sender: { name: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: '12 ถ.นารายณ์มหาราช ลพบุรี', phone: '02-000-0000' },
  qrValue: 'https://app.test/sales?saleId=s1',
};

describe('ParcelLabelCard — กระดาษ 100×150 ตาม mockup', () => {
  it('หัว · ขนส่งที่เลือกติ๊ก · ผู้รับ · ของในกล่อง + IMEI + ของแถม · เก็บเงินปลายทาง · QR · ผู้ส่ง', () => {
    render(<ParcelLabelCard draft={draft} printedAt={new Date('2026-10-22T08:00:00+07:00')} />);
    const paper = screen.getByTestId('parcel-label');

    expect(paper).toHaveTextContent('BESTCHOICE');
    expect(paper).toHaveTextContent('ใบปะหน้าพัสดุ');
    expect(within(paper).getAllByText('S-20261022-0001')).toHaveLength(2);
    expect(within(paper).getByRole('img', { name: 'Kerry เลือกแล้ว' })).toBeInTheDocument();
    expect(within(paper).getByRole('img', { name: 'Flash ยังไม่เลือก' })).toBeInTheDocument();
    expect(paper).toHaveTextContent('22 ต.ค.');

    expect(paper).toHaveTextContent('นางสาว สมหญิง ใจดี');
    expect(paper).toHaveTextContent('0899999999');
    expect(paper).toHaveTextContent('99/1 ม.2 ต.ท่าหิน อ.เมืองลพบุรี');
    expect(paper).toHaveTextContent('ลพบุรี');
    expect(paper).toHaveTextContent('15000');
    expect(paper).toHaveTextContent('หมายเหตุถึงขนส่ง: โทรก่อนส่ง');

    expect(paper).toHaveTextContent('Apple iPhone 15 Pro Max 256GB ดำ');
    expect(paper).toHaveTextContent('IMEI 357200606382344');
    expect(paper).toHaveTextContent('+ เคสใส · ฟิล์มกระจก');
    expect(paper).toHaveTextContent('เก็บเงินปลายทาง');
    expect(paper).toHaveTextContent('ไม่มี');
    expect(within(paper).getByRole('img', { name: 'QR เปิดใบขาย S-20261022-0001' })).toBeInTheDocument();

    expect(paper).toHaveTextContent('ผู้ส่ง');
    expect(paper).toHaveTextContent('บริษัท เบสท์ช้อยส์โฟน จำกัด');
    expect(paper).toHaveTextContent('12 ถ.นารายณ์มหาราช ลพบุรี · โทร 02-000-0000');
    expect(paper).toHaveTextContent('ยิง QR ตอนส่ง/รับคืน เพื่อเปิดใบขาย');
  });

  it('ไม่มี IMEI/ของแถม/หมายเหตุ/ขนส่ง → ไม่พิมพ์บรรทัดว่าง · หมายเหตุเป็น — · ช่องทั้ง 4 ว่าง · ผู้ส่งไม่มีเบอร์ไม่พิมพ์ "โทร"', () => {
    render(
      <ParcelLabelCard
        draft={{
          ...draft,
          carrier: null,
          note: '',
          item: { title: 'หูฟัง', imei: null, extras: [] },
          sender: { name: 'BESTCHOICE', address: '', phone: '' },
        }}
      />,
    );
    const paper = screen.getByTestId('parcel-label');

    expect(paper).not.toHaveTextContent('IMEI');
    expect(paper).not.toHaveTextContent('+ ');
    expect(paper).toHaveTextContent('หมายเหตุถึงขนส่ง: —');
    expect(paper).not.toHaveTextContent('โทร');
    for (const label of ['Flash', 'Kerry', 'J&T', 'ไปรษณีย์']) {
      expect(within(paper).getByRole('img', { name: `${label} ยังไม่เลือก` })).toBeInTheDocument();
    }
  });
});
