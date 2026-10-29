import type { DumpRow, DumpTables } from '../dump-reader';
import { buildLegacyBook, LEGACY_TABLES } from '../legacy-book';

/**
 * จัดกลุ่มแถวของ dump ระบบเก่ารายสัญญา — ค่าเป็นข้อมูลสังเคราะห์ทั้งหมด (รหัส TEST-*, ยอดเงินกลม ๆ)
 * ชื่อคอลัมน์ตรงกับ CREATE TABLE ของ dump จริง (เลือกมาเฉพาะคอลัมน์ที่ใช้)
 */

function ins(
  id: string,
  contractId: string | null,
  due: string,
  amount: string,
  paid: string,
  balance: string,
  status: string,
): DumpRow {
  return {
    ins_id: id,
    ins_payment_code: `TEST-I-${id}`,
    ref_order_id: '101',
    ref_contract_id: contractId,
    ins_amount: amount,
    ins_discount: '0',
    ins_paid: paid,
    ins_balance: balance,
    ins_due_date: due,
    ins_status: status,
  };
}

function pay(
  id: string,
  contractId: string | null,
  installmentId: string,
  date: string,
  amount: string,
  status: string,
): DumpRow {
  return {
    id,
    code: `TEST-P-${id}`,
    ref_order: '101',
    ref_contract: contractId,
    ref_installmemnt: installmentId,
    installment: amount,
    mulct: '0',
    discount: '0',
    amount,
    slip: `TEST-${id}.jpg`,
    date,
    status,
    type: '0',
    created_at: '2026-03-10 12:00:00',
  };
}

function contractRow(id: string, order: string, status: string, createdAt: string | null): DumpRow {
  return {
    contract_id: id,
    contract_code: `TEST-C-000${id}`,
    ref_order: order,
    contract_status: status,
    created_at: createdAt,
  };
}

/** สองสัญญา: 1 ผ่อนอยู่ (3 งวด ใน dump ไม่เรียงวัน) · 2 ปิดก่อนกำหนด · คำสั่งซื้อ 103 ไม่ได้ทำสัญญา */
function baseTables(): DumpTables {
  const t: DumpTables = Object.fromEntries(LEGACY_TABLES.map((name) => [name, []]));
  t.bestchoice_contract = [
    contractRow('1', '101', '2', '2026-01-05 10:00:00'),
    contractRow('2', '102', '3', '2025-11-13 23:30:00'),
  ];
  t.bestchoice_order_product = ['101', '102', '103'].map((id) => ({
    order_id: id,
    order_code: `TEST-O-${id}`,
    ref_member: id === '102' ? '502' : '501',
    order_status: id === '103' ? '4' : '3',
    created_at: '2026-01-04 09:00:00',
  }));
  t.bestchoice_order_product_detail = [
    { detail_id: '1', ref_order_id: '101', mobile_imei: '350000000000001' },
    { detail_id: '2', ref_order_id: '102', mobile_imei: '350000000000001' }, // IMEI ซ้ำได้ (เครื่องขายต่อ)
  ];
  t.bestchoice_member_master = [
    { member_id: '501', member_code: 'TEST-M-0501' },
    { member_id: '502', member_code: 'TEST-M-0502' },
  ];
  t.bestchoice_order_product_installment = [
    ins('13', '1', '2026-04-05', '1000', '0', '1000', '0'),
    ins('11', '1', '2026-02-05', '1000', '1000', '0', '4'),
    ins('12', '1', '2026-03-05', '1000', '400', '600', '3'),
    ins('21', '2', '2026-02-05', '5000', '5000', '0', '4'),
  ];
  t.bestchoice_payment_installment = [
    pay('1', '1', '11', '2026-02-04', '1000', '1'),
    pay('2', '1', '12', '2026-03-01', '600', '0'),
    pay('3', '1', '12', '2026-03-04', '400', '1'),
  ];
  t.bestchoice_contract_close = [
    {
      id: '1',
      code: 'TEST-CL-1',
      ref_order: '102',
      ref_contract: '2',
      balance: '5000',
      discount: '250',
      amount: '4750',
      slip: 'TEST-CL-1.jpg',
      created_at: '2026-03-01 09:00:00',
    },
  ];
  t.bestchoice_order_product_img_contract = [
    { img_id: '1', ref_order: '101', file_detail: 'สัญญา', file_name: 'TEST-1.jpg' },
    { img_id: '2', ref_order: '103', file_detail: 'สัญญา', file_name: 'TEST-3.jpg' }, // ไม่ได้ทำสัญญา
    { img_id: '3', ref_order: '101', file_detail: 'สัญญา', file_name: null }, // ไม่มีไฟล์
  ];
  t.bestchoice_contract_file = [
    { img_id: '1', ref_contract: '2', file_detail: 'เอกสาร', file_name: 'TEST-2.pdf' },
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
    expect(c1.order.order_code).toBe('TEST-O-101');
    expect(c2.detail.ref_order_id).toBe('102');
    expect(c2.installments.map((i) => i.legacyId)).toEqual(['21']);
    expect(c1.close).toBeNull();
    expect(c2.close?.amount.toFixed(2)).toBe('4750.00');
    expect(c2.close?.discount.toFixed(2)).toBe('250.00');
    expect(c2.close?.createdAt).toEqual(new Date('2026-03-01T09:00:00+07:00'));
    // รูปของคำสั่งซื้ออ้าง ref_order · ไฟล์ของสัญญาอ้าง ref_contract
    expect(c1.files).toEqual([{ kind: 'img_contract', path: 'TEST-1.jpg' }]);
    expect(c2.files).toEqual([{ kind: 'contract_file', path: 'TEST-2.pdf' }]);
    expect(book.members.get('502')?.member_code).toBe('TEST-M-0502');
    expect(book.anomalies).toEqual([]);
  });

  it('leaves out receipts that were deleted in the old system (status 0)', () => {
    const [c1] = buildLegacyBook(baseTables()).contracts;
    expect(c1.receipts.map((r) => r.legacyId)).toEqual(['1', '3']);
    expect(c1.receipts[1]).toMatchObject({ installmentLegacyId: '12', slipPath: 'TEST-3.jpg' });
  });

  it('sorts installments by due date, not by dump order', () => {
    const [c1] = buildLegacyBook(baseTables()).contracts;
    expect(c1.installments.map((i) => [i.legacyId, i.legacyCode, i.statusCode])).toEqual([
      ['11', 'TEST-I-11', '4'],
      ['12', 'TEST-I-12', '3'],
      ['13', 'TEST-I-13', '0'],
    ]);
  });

  it('uses ins_id as the installment code when ins_payment_code is empty', () => {
    const t = baseTables();
    t.bestchoice_order_product_installment[1].ins_payment_code = null;
    const [c1] = buildLegacyBook(t).contracts;
    expect(c1.installments[0]).toMatchObject({ legacyId: '11', legacyCode: '11' });
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
    expect(book.anomalies[0]).toContain('id=3');
    expect(book.anomalies[0]).toContain('2569');
  });

  it('records rows that point nowhere as anomalies (without reading their values)', () => {
    const t = baseTables();
    t.bestchoice_payment_installment.push(
      pay('4', '9', '91', '2026-03-05', '100', '1'), // สัญญาที่ไม่มี
      pay('5', '1', '21', '2026-03-05', '100', '1'), // งวดของอีกสัญญา
      pay('6', null, '0', 'วันที่เสีย', '100', '1'), // ไม่อ้างสัญญา — ค่าเสียไม่ถูกอ่าน
    );
    t.bestchoice_order_product_installment.push(
      ins('91', '9', '2026-02-05', '100', '0', '100', '0'),
      ins('92', null, '', '100', '0', '100', '9'),
    );
    t.bestchoice_contract_close.push({
      ...t.bestchoice_contract_close[0],
      id: '2',
      ref_contract: '0',
    });
    const book = buildLegacyBook(t);

    expect(book.contracts[0].receipts.map((r) => r.legacyId)).toEqual(['1', '3', '5']);
    expect(book.anomalies.find((a) => a.includes('id=5'))).toContain('TEST-C-0001');
    expect(book.anomalies.filter((a) => a.includes('ไม่พบสัญญา'))).toEqual([
      expect.stringContaining('ref_contract_id=9'),
      expect.stringContaining('ref_contract_id=NULL'),
      expect.stringContaining('ref_contract=9'),
      expect.stringContaining('ref_contract=NULL'),
      expect.stringContaining('ref_contract=0'),
    ]);
  });

  describe('status-0 contracts without a code or date (controller ruling 29/10)', () => {
    function withStub(code: string | null, createdAt: string | null): DumpTables {
      const t = baseTables();
      t.bestchoice_contract.push({
        ...contractRow('3', '103', '0', createdAt),
        contract_code: code,
      });
      t.bestchoice_order_product_detail.push({ detail_id: '3', ref_order_id: '103' });
      return t;
    }

    it('keeps them with a stand-in code and the order date, and records anomalies', () => {
      const book = buildLegacyBook(withStub(null, null));
      const stub = book.contracts[2];
      expect(stub).toMatchObject({ contractId: '3', code: 'contract_id=3', statusCode: '0' });
      expect(stub.createdAt).toEqual(new Date('2026-01-04T02:00:00Z')); // order_product.created_at
      expect(book.anomalies).toHaveLength(2);
      expect(book.anomalies.every((a) => a.includes('contract_id=3'))).toBe(true);
    });

    it('stays strict for any other status', () => {
      const t = baseTables();
      t.bestchoice_contract[0].created_at = null;
      expect(() => buildLegacyBook(t)).toThrow('contract_id=1');
      t.bestchoice_contract[0].created_at = '2026-01-05 10:00:00';
      t.bestchoice_contract[0].contract_code = null;
      expect(() => buildLegacyBook(t)).toThrow('contract_id=1');
    });
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
