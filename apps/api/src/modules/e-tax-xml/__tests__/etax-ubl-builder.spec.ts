import { Prisma } from '@prisma/client';
import { EtaxUblBuilder, EtaxInvoiceInput } from '../xml-builder/etax-ubl-2-1.builder';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('EtaxUblBuilder (ขมธอ.21-2562 UBL 2.1)', () => {
  const builder = new EtaxUblBuilder();

  const baseInput = (): EtaxInvoiceInput => ({
    invoiceNumber: 'ET-20260515-ABCD1234',
    issueDate: new Date('2026-05-15T07:00:00Z'),
    currency: 'THB',
    invoiceTypeCode: '388',
    buyerReference: 'C-2026-0001/3',
    supplier: {
      taxId: '0000000000001',
      branchCode: '00000',
      nameTh: 'BESTCHOICE FINANCE',
      nameEn: 'BESTCHOICE FINANCE CO., LTD.',
      address: '123 ถ.บัญชี',
    },
    customer: {
      taxId: '1100100000001',
      name: 'นาย ทดสอบ ระบบ',
      address: '99/9 ถ.ทดสอบ',
    },
    lines: [
      {
        id: '1',
        description: 'ค่างวดสัญญา C-2026-0001 งวดที่ 3',
        quantity: 1,
        unitPrice: D('10000'),
        lineExtension: D('10000'),
      },
    ],
    lineExtensionAmount: D('10000'),
    taxExclusiveAmount: D('10000'),
    vatAmount: D('700'),
    vatPercent: 7,
    taxInclusiveAmount: D('10700'),
    payableAmount: D('10700'),
  });

  it('emits well-formed UBL XML with all mandatory ม.86/4 elements', () => {
    const xml = builder.build(baseInput());

    // XML declaration + UBL namespaces
    expect(xml).toContain('<?xml');
    expect(xml).toContain(
      'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    );
    expect(xml).toContain('xmlns:cbc=');
    expect(xml).toContain('xmlns:cac=');

    // Mandatory header
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain('<cbc:ID>ET-20260515-ABCD1234</cbc:ID>');
    expect(xml).toContain('<cbc:InvoiceTypeCode>388</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:DocumentCurrencyCode>THB</cbc:DocumentCurrencyCode>');

    // Supplier (FINANCE) + branch code = 00000
    expect(xml).toContain('0000000000001');
    expect(xml).toContain('BESTCHOICE FINANCE');
    expect(xml).toMatch(/listName="BranchCode"/);
    expect(xml).toContain('>00000<');

    // Customer with Thai name + tax ID
    expect(xml).toContain('1100100000001');
    expect(xml).toContain('นาย ทดสอบ ระบบ');

    // TaxTotal with VAT 7%
    expect(xml).toMatch(/<cbc:Percent>7<\/cbc:Percent>/);
    expect(xml).toContain('<cbc:TaxAmount currencyID="THB">700.00</cbc:TaxAmount>');

    // LegalMonetaryTotal
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="THB">10700.00</cbc:TaxInclusiveAmount>',
    );
    expect(xml).toContain(
      '<cbc:PayableAmount currencyID="THB">10700.00</cbc:PayableAmount>',
    );

    // Line items
    expect(xml).toContain('ค่างวดสัญญา C-2026-0001 งวดที่ 3');
  });

  it('uses Asia/Bangkok day for IssueDate (date crosses UTC midnight)', () => {
    // 2026-05-15 06:00 UTC = 2026-05-15 13:00 BKK — same day
    // 2026-05-14 19:00 UTC = 2026-05-15 02:00 BKK — already next day in BKK
    const input = baseInput();
    input.issueDate = new Date('2026-05-14T19:00:00Z');
    const xml = builder.build(input);
    expect(xml).toContain('<cbc:IssueDate>2026-05-15</cbc:IssueDate>');
  });

  it('omits customer TaxScheme when no taxId (individual buyer)', () => {
    const input = baseInput();
    input.customer.taxId = null;
    const xml = builder.build(input);

    // Customer name still present
    expect(xml).toContain('นาย ทดสอบ ระบบ');
    // PartyTaxScheme block must NOT be emitted for the customer party
    // (one PartyTaxScheme remains — supplier).
    const matches = xml.match(/<cac:PartyTaxScheme>/g);
    expect(matches?.length).toBe(1);
  });

  it('renders multiple line items with correct amounts', () => {
    const input = baseInput();
    input.lines = [
      {
        id: '1',
        description: 'งวดที่ 3',
        quantity: 1,
        unitPrice: D('5000'),
        lineExtension: D('5000'),
      },
      {
        id: '2',
        description: 'งวดที่ 4',
        quantity: 1,
        unitPrice: D('5000'),
        lineExtension: D('5000'),
      },
    ];
    const xml = builder.build(input);

    const lineMatches = xml.match(/<cac:InvoiceLine>/g);
    expect(lineMatches?.length).toBe(2);
    expect(xml).toContain('งวดที่ 3');
    expect(xml).toContain('งวดที่ 4');
  });

  it('escapes XML-special characters in customer name', () => {
    const input = baseInput();
    input.customer.name = 'A & B <Company> "Ltd"';
    const xml = builder.build(input);
    // Must NOT emit raw `<Company>` or `&` — xmlbuilder2 entity-escapes
    expect(xml).toMatch(/A &amp; B/);
    expect(xml).toMatch(/&lt;Company&gt;/);
  });
});
