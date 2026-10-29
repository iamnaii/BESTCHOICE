import type { DumpRow, DumpTables } from '../dump-reader';
import { buildLegacyBook, LEGACY_TABLES } from '../legacy-book';

/**
 * จัดกลุ่มแถวของ dump ระบบเก่ารายสัญญา — ข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-*, ยอดเงินกลม ๆ)
 * ชื่อคอลัมน์เป็นชื่อที่ตัวจัดกลุ่มรองรับ ไม่ได้คัดลอกค่าจาก dump จริง
 */

function ins(
  id: string,
  contractId: string,
  due: string,
  amount: string,
  paid: string,
  balance: string,
  status: string,
): DumpRow {
  return {
    ins_id: id,
    ins_code: `TEST-I-${id}`,
    ref_contract_id: contractId,
    ref_order_id: `10${contractId}`,
    ins_due_date: due,
    ins_amount: amount,
    ins_paid: paid,
    ins_balance: balance,
    ins_status: status,
  };
}

function pay(
  id: string,
  contractId: string,
  installmentId: string | null,
  date: string,
  amount: string,
  status: string,
): DumpRow {
  return {
    payment_id: id,
    ref_contract: contractId,
    ref_installmemnt: installmentId,
    ref_order: `10${contractId}`,
    date,
    amount,
    installment: amount,
    mulct: '0.00',
    discount: '0.00',
    slip: `uploads/slip/TEST-${id}.jpg`,
    type: '0',
    status,
    created_at: '2026-03-10 12:00:00',
  };
}

/** สองสัญญา: 1 ผ่อนอยู่ (3 งวด ใน dump ไม่เรียงวัน) · 2 ปิดก่อนกำหนด · คำสั่งซื้อ 103 ไม่ได้ทำสัญญา */
function baseTables(): DumpTables {
  const t: DumpTables = Object.fromEntries(LEGACY_TABLES.map((name) => [name, []]));
  t.bestchoice_contract = [
    {
      contract_id: '1',
      contract_code: 'TEST-C-0001',
      ref_order: '101',
      contract_status: '2',
      created_at: '2026-01-05 10:00:00',
    },
    {
      contract_id: '2',
      contract_code: 'TEST-C-0002',
      ref_order: '102',
      contract_status: '3',
      created_at: '2025-11-13 23:30:00',
    },
  ];
  t.bestchoice_order_product = [
    { order_id: '101', order_code: 'TEST-O-0101', ref_member: '501', order_status: '3' },
    { order_id: '102', order_code: 'TEST-O-0102', ref_member: '502', order_status: '3' },
    { order_id: '103', order_code: 'TEST-O-0103', ref_member: '501', order_status: '4' },
  ];
  t.bestchoice_order_product_detail = [
    { detail_id: '1', ref_order_id: '101', mobile_imei: '350000000000001' },
    { detail_id: '2', ref_order_id: '102', mobile_imei: '350000000000001' }, // IMEI ซ้ำได้ (เครื่องขายต่อ)
  ];
  t.bestchoice_member_master = [
    { member_id: '501', member_code: 'TEST-M-0501' },
    { member_id: '502', member_code: 'TEST-M-0502' },
  ];
  t.bestchoice_order_product_installment = [
    ins('13', '1', '2026-04-05', '1000.00', '0.00', '1000.00', '0'),
    ins('11', '1', '2026-02-05', '1000.00', '1000.00', '0.00', '4'),
    ins('12', '1', '2026-03-05', '1000.00', '400.00', '600.00', '3'),
    ins('21', '2', '2026-02-05', '5000.00', '5000.00', '0.00', '4'),
  ];
  t.bestchoice_payment_installment = [
    pay('1', '1', '11', '2026-02-04', '1000.00', '1'),
    pay('2', '1', '12', '2026-03-01', '600.00', '0'),
    pay('3', '1', '12', '2026-03-04', '400.00', '1'),
  ];
  t.bestchoice_contract_close = [
    {
      close_id: '1',
      ref_contract: '2',
      amount: '4750.00',
      discount: '250.00',
      created_at: '2026-03-01 09:00:00',
    },
  ];
  // ชื่อคอลัมน์ path ต่างกันระหว่างตาราง และตารางหนึ่งอ้าง ref_order_id อีกตารางอ้าง ref_order
  t.bestchoice_order_product_img_contract = [
    { img_id: '1', ref_order_id: '101', img: 'uploads/contract/TEST-1.jpg' },
    { img_id: '2', ref_order_id: '103', img: 'uploads/contract/TEST-3.jpg' }, // ไม่ได้ทำสัญญา
    { img_id: '3', ref_order_id: '101', img: '' }, // ไม่มีไฟล์
  ];
  t.bestchoice_contract_file = [
    { file_id: '1', ref_order: '102', file_name: 'upload/file/TEST-2.pdf' },
  ];
  return t;
}

describe('LEGACY_TABLES', () => {
  it('lists the 16 dump tables the import reads', () => {
    expect([...LEGACY_TABLES].sort()).toEqual(
      [
        'bestchoice_contract',
        'bestchoice_order_product',
        'bestchoice_order_product_detail',
        'bestchoice_order_product_installment',
        'bestchoice_payment_installment',
        'bestchoice_member_master',
        'bestchoice_contract_close',
        'bestchoice_order_product_img_contract',
        'bestchoice_order_product_img_facebook',
        'bestchoice_order_product_img_income',
        'bestchoice_order_product_img_line',
        'bestchoice_order_product_img_lock',
        'bestchoice_order_product_img_receive',
        'bestchoice_order_product_img_selfie',
        'bestchoice_order_product_file',
        'bestchoice_contract_file',
      ].sort(),
    );
  });
});

describe('buildLegacyBook', () => {
  it('groups order, detail, installments, close and files under each contract', () => {
    const book = buildLegacyBook(baseTables());

    expect(book.contracts.map((c) => [c.contractId, c.code, c.statusCode])).toEqual([
      ['1', 'TEST-C-0001', '2'],
      ['2', 'TEST-C-0002', '3'],
    ]);
    const [c1, c2] = book.contracts;
    expect(c1.order.order_code).toBe('TEST-O-0101');
    expect(c2.detail.ref_order_id).toBe('102');
    expect(c2.installments.map((i) => i.legacyId)).toEqual(['21']);
    expect(c1.close).toBeNull();
    expect(c2.close?.amount.toFixed(2)).toBe('4750.00');
    expect(c2.close?.discount.toFixed(2)).toBe('250.00');
    expect(c2.close?.createdAt).toEqual(new Date('2026-03-01T09:00:00+07:00'));
    expect(c1.files).toEqual([{ kind: 'img_contract', path: 'uploads/contract/TEST-1.jpg' }]);
    expect(c2.files).toEqual([{ kind: 'contract_file', path: 'upload/file/TEST-2.pdf' }]);
    expect(book.members.get('502')?.member_code).toBe('TEST-M-0502');
    expect(book.anomalies).toEqual([]);
  });

  it('leaves out receipts that were deleted in the old system (status 0)', () => {
    const [c1] = buildLegacyBook(baseTables()).contracts;
    expect(c1.receipts.map((r) => r.legacyId)).toEqual(['1', '3']);
    expect(c1.receipts[1]).toMatchObject({
      installmentLegacyId: '12',
      slipPath: 'uploads/slip/TEST-3.jpg',
    });
  });

  it('sorts installments by due date, not by dump order', () => {
    const [c1] = buildLegacyBook(baseTables()).contracts;
    expect(c1.installments.map((i) => [i.legacyId, i.legacyCode, i.statusCode])).toEqual([
      ['11', 'TEST-I-11', '4'],
      ['12', 'TEST-I-12', '3'],
      ['13', 'TEST-I-13', '0'],
    ]);
  });

  it('reads legacy datetimes as Bangkok time and money as exact Decimal', () => {
    const t = baseTables();
    t.bestchoice_order_product_installment[0].ins_amount = '333.3333';
    const [c1, c2] = buildLegacyBook(t).contracts;

    expect(c1.createdAt).toEqual(new Date('2026-01-05T03:00:00Z'));
    expect(c2.createdAt).toEqual(new Date('2025-11-13T16:30:00Z'));
    expect(c1.installments[0].dueDate).toEqual(new Date('2026-02-04T17:00:00Z'));
    expect(c1.receipts[0].date).toEqual(new Date('2026-02-03T17:00:00Z'));
    expect(c1.receipts[0].createdAt).toEqual(new Date('2026-03-10T05:00:00Z'));
    expect(c1.installments[1].paid.toFixed(2)).toBe('400.00');
    expect(c1.installments[2].amount.toString()).toBe('333.3333'); // ไม่ปัด — ปล่อยให้ขั้นคำนวณเงินตัดสิน
  });

  it('reads a Buddhist-era year as the Christian year and records an anomaly', () => {
    const t = baseTables();
    t.bestchoice_payment_installment[2].date = '2569-03-04';
    const book = buildLegacyBook(t);

    expect(book.contracts[0].receipts[1].date).toEqual(new Date('2026-03-03T17:00:00Z'));
    expect(book.anomalies).toHaveLength(1);
    expect(book.anomalies[0]).toContain('payment_id=3');
    expect(book.anomalies[0]).toContain('2569');
  });

  it('records rows that point nowhere as anomalies instead of dropping them silently', () => {
    const t = baseTables();
    t.bestchoice_payment_installment.push(pay('4', '9', '91', '2026-03-05', '100.00', '1'));
    t.bestchoice_payment_installment.push(pay('5', '1', '21', '2026-03-05', '100.00', '1'));
    t.bestchoice_order_product_installment.push(
      ins('91', '9', '2026-02-05', '100.00', '0.00', '100.00', '0'),
    );
    const book = buildLegacyBook(t);

    expect(book.contracts[0].receipts.map((r) => r.legacyId)).toEqual(['1', '3', '5']);
    expect(book.anomalies).toHaveLength(3);
    expect(book.anomalies.find((a) => a.includes('payment_id=5'))).toContain('TEST-C-0001');
    expect(book.anomalies.some((a) => a.includes('ref_contract=9'))).toBe(true);
    expect(book.anomalies.some((a) => a.includes('ref_contract_id=9'))).toBe(true);
  });

  describe('fails loudly when the dump does not fit', () => {
    it('names the table and the columns it has when a required column is missing', () => {
      const t = baseTables();
      for (const row of t.bestchoice_order_product_installment) delete row.ins_amount;
      const error = (() => {
        try {
          buildLegacyBook(t);
          return null;
        } catch (e) {
          return e as Error;
        }
      })();
      expect(error?.message).toContain('`bestchoice_order_product_installment`');
      expect(error?.message).toContain('ins_amount');
      expect(error?.message).toContain('ins_paid'); // รายชื่อคอลัมน์ที่มีจริง
      expect(error?.message).not.toContain('TEST-I-'); // ไม่มีค่าในแถว
    });

    it('rejects a contract whose order is not in the dump', () => {
      const t = baseTables();
      t.bestchoice_order_product = t.bestchoice_order_product.filter((o) => o.order_id !== '102');
      expect(() => buildLegacyBook(t)).toThrow('contract_id=2');
    });
  });
});
