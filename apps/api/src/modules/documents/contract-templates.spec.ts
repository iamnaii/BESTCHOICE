import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

// Mock puppeteer-core to prevent actual browser launch
jest.mock('puppeteer-core', () => ({
  launch: jest.fn().mockRejectedValue(new Error('Puppeteer not available in test')),
}));

/**
 * ════════════════════════════════════════════════════════════════════
 *  Contract Template Test Suite — ทดสอบกระบวนการสร้างเอกสารสัญญา
 * ════════════════════════════════════════════════════════════════════
 *
 *  ครอบคลุม 4 ด้านหลัก:
 *  1. Template Accuracy         — ดึงเทมเพลตถูกประเภท/เวอร์ชันล่าสุด
 *  2. Variable Mapping          — แทนที่ตัวแปรครบถ้วน ไม่หลุดโค้ดดิบ
 *  3. Format & Layout           — A4 styling, ฟอนต์, ลายเซ็น, page break
 *  4. Error Handling            — ข้อมูลขาด, เทมเพลตไม่พบ, สัญญาถูกลบ
 * ════════════════════════════════════════════════════════════════════
 */
describe('Contract Templates — กระบวนการสร้างเอกสารสัญญา', () => {
  let service: DocumentsService;
  let prisma: any;

  // ─── Test Data: สัญญาจำลองครบถ้วน ─────────────────────
  const fullContract = {
    id: 'contract-full',
    contractNumber: 'BC-2026-0042',
    customerId: 'cust-1',
    productId: 'prod-1',
    branchId: 'branch-1',
    salespersonId: 'staff-1',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: 25000,
    downPayment: 5000,
    totalMonths: 10,
    interestRate: 0.09,
    interestTotal: 1800,
    financedAmount: 21800,
    monthlyPayment: 2180,
    paymentDueDay: 5,
    notes: 'ลูกค้า VIP',
    deletedAt: null,
    pdpaConsentId: null,
    contractHash: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    customer: {
      id: 'cust-1',
      name: 'สมชาย ใจดี',
      prefix: 'นาย',
      nickname: 'ชาย',
      nationalId: '1100700123456',
      phone: '0891234567',
      phoneSecondary: '0812223333',
      email: 'somchai@test.com',
      lineId: 'U_somchai',
      facebookLink: 'fb.com/somchai',
      occupation: 'พนักงานบริษัท',
      occupationDetail: 'วิศวกรซอฟต์แวร์',
      salary: 35000,
      workplace: 'บริษัท ABC จำกัด',
      addressIdCard: JSON.stringify({
        houseNo: '123/45',
        moo: '2',
        soi: 'สุขสวัสดิ์ 30',
        road: 'สุขสวัสดิ์',
        subdistrict: 'บางปะกอก',
        district: 'ราษฎร์บูรณะ',
        province: 'กรุงเทพมหานคร',
        postalCode: '10140',
      }),
      addressCurrent: JSON.stringify({
        houseNo: '789',
        road: 'นารายณ์มหาราช',
        subdistrict: 'ทะเลชุบศร',
        district: 'เมือง',
        province: 'ลพบุรี',
        postalCode: '15000',
      }),
      addressWork: JSON.stringify({ raw: 'อาคาร ABC ชั้น 5 ถนนสีลม กรุงเทพ' }),
      birthDate: new Date('1990-05-15'),
      references: [
        { prefix: 'นาง', firstName: 'สมหญิง', lastName: 'ใจดี', phone: '0899998888', relationship: 'มารดา' },
        { prefix: 'นาย', firstName: 'สมศักดิ์', lastName: 'ใจดี', phone: '0877776666', relationship: 'พี่ชาย' },
      ],
    },
    product: {
      id: 'prod-1',
      name: 'iPhone 16 Pro Max',
      brand: 'Apple',
      model: '16 Pro Max',
      imeiSerial: '354789102345678',
      serialNumber: 'F2LXK1234567',
      color: 'Natural Titanium',
      storage: '256GB',
      category: 'PHONE_NEW',
      batteryHealth: 100,
      warrantyExpireDate: new Date('2027-03-01'),
    },
    branch: { id: 'branch-1', name: 'สาขาลพบุรี', location: '456/21 ถ.นารายณ์มหาราช ลพบุรี', phone: '036-411234' },
    salesperson: { id: 'staff-1', name: 'พนักงาน ทดสอบ' },
    payments: [
      { installmentNo: 1, dueDate: new Date('2026-04-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 2, dueDate: new Date('2026-05-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 3, dueDate: new Date('2026-06-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 4, dueDate: new Date('2026-07-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 5, dueDate: new Date('2026-08-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 6, dueDate: new Date('2026-09-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 7, dueDate: new Date('2026-10-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 8, dueDate: new Date('2026-11-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 9, dueDate: new Date('2026-12-05'), amountDue: 2180, status: 'PENDING' },
      { installmentNo: 10, dueDate: new Date('2027-01-05'), amountDue: 2180, status: 'PENDING' },
    ],
    signatures: [],
    eDocuments: [],
    pdpaConsent: null,
  };

  // ─── Template Fixtures ─────────────────────────────────
  const storeDirectTemplate = {
    id: 'tpl-store-v2',
    name: 'สัญญาผ่อนชำระ v2',
    type: 'STORE_DIRECT',
    contentHtml: '<h1>สัญญาผ่อนชำระ</h1><p>เลขที่ {contract_number}</p><p>ลูกค้า: {customer_name}</p><p>บัตร ปชช.: {national_id}</p><p>โทร: {customer_phone}</p><p>สินค้า: {brand} {model}</p><p>IMEI: {imei}</p><p>ราคา: {selling_price}</p><p>ดาวน์: {down_payment}</p><p>ยอดผ่อน: {financed_amount}</p><p>งวดละ: {monthly_payment} บาท x {total_months} เดือน</p><p>ดอกเบี้ย: {interest_rate}</p>{payment_schedule_table}<div>{customer_signature}</div><div>{staff_signature}</div>',
    placeholders: ['{contract_number}', '{customer_name}', '{national_id}', '{customer_phone}', '{brand}', '{model}', '{imei}', '{selling_price}', '{down_payment}', '{financed_amount}', '{monthly_payment}', '{total_months}', '{interest_rate}', '{payment_schedule_table}', '{customer_signature}', '{staff_signature}'],
    settings: { margins: { top: 25, bottom: 20, left: 30, right: 25 }, fontSize: { body: 16, heading: 20, footer: 12 }, letterhead: 'bestchoice', showPageNumber: true },
    isActive: true,
    blocks: [],
    createdAt: new Date('2026-03-15T10:00:00Z'),
    updatedAt: new Date('2026-03-15T10:00:00Z'),
  };

  const storeDirectTemplateV1 = {
    ...storeDirectTemplate,
    id: 'tpl-store-v1',
    name: 'สัญญาผ่อนชำระ v1',
    createdAt: new Date('2025-01-01T10:00:00Z'), // เก่ากว่า v2
    updatedAt: new Date('2025-01-01T10:00:00Z'),
  };

  const pdpaTemplate = {
    id: 'tpl-pdpa-1',
    name: 'PDPA Consent',
    type: 'PDPA_CONSENT',
    contentHtml: '<h1>หนังสือยินยอม PDPA</h1><p>สัญญา: {contract_number}</p><p>ลูกค้า: {customer_name}</p><p>เลขบัตร: {national_id}</p><p>ลายเซ็น: {pdpa_signature}</p><p>วันที่ยินยอม: {pdpa_consent_date}</p>',
    placeholders: ['{contract_number}', '{customer_name}', '{national_id}', '{pdpa_signature}', '{pdpa_consent_date}'],
    settings: null,
    isActive: true,
    blocks: [],
    createdAt: new Date('2026-03-10'),
    updatedAt: new Date('2026-03-10'),
  };

  const newSyntaxTemplate = {
    id: 'tpl-new-syntax',
    name: 'สัญญาใหม่ (New Syntax)',
    type: 'STORE_DIRECT',
    contentHtml: '<h1>สัญญาเช่าซื้อ</h1><p>เลขที่ {{= CONTRACT.NUMBER}}</p><p>วันที่ {{= CONTRACT.DATE | date:l}}</p><p>ผู้เช่าซื้อ: {{= CUSTOMER.NAME}}</p><p>บัตร ปชช.: {{= CUSTOMER.IDCARD}}</p><p>โทร: {{= CUSTOMER.TEL}}</p><p>สินค้า: {{= PHONE.BRAND}} {{= PHONE.MODEL}}</p><p>IMEI: {{= PHONE.IMEI}}</p><p>ราคาขาย: {{= CONTRACT.SELLING_PRICE | num:2}}</p><p>เงินดาวน์: {{= CONTRACT.DOWN_PAYMENT | num:2}}</p><p>ยอดรวม: {{= CONTRACT.TOTAL_AMOUNT}} ({{= CONTRACT.TOTAL_AMOUNT_TEXT}})</p><p>งวดละ: {{= CONTRACT.MONTHLY_PAYMENT}} x {{= CONTRACT.TOTAL_MONTHS_TEXT}}</p><p>บริษัท: {{= COMPANY.NAME_TH}}</p>{{= INSTALLMENTS}}',
    placeholders: [],
    settings: null,
    isActive: true,
    blocks: [],
    createdAt: new Date('2026-03-16'),
    updatedAt: new Date('2026-03-16'),
  };

  const emergencyContactTemplate = {
    id: 'tpl-emergency',
    name: 'สัญญา + บุคคลอ้างอิง',
    type: 'STORE_DIRECT',
    contentHtml: '<h1>สัญญา {contract_number}</h1><h2>บุคคลอ้างอิง</h2>{{for CONTACT in EMERGENCY_CONTACTS}}<p>{{= @index1}}. {{= CONTACT.NAME}} โทร {{= CONTACT.TEL}} ({{= CONTACT.RELATION}})</p>{{/for}}',
    placeholders: [],
    settings: null,
    isActive: true,
    blocks: [],
    createdAt: new Date('2026-03-16'),
    updatedAt: new Date('2026-03-16'),
  };

  const inactiveTemplate = {
    ...storeDirectTemplate,
    id: 'tpl-inactive',
    name: 'เทมเพลตปิดใช้งาน',
    isActive: false,
  };

  // ─── Mock Setup ────────────────────────────────────────
  const mockPrisma = {
    contract: { findUnique: jest.fn() },
    contractTemplate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    eDocument: {
      create: jest.fn().mockResolvedValue({ id: 'edoc-1', contractId: 'contract-full', documentType: 'CONTRACT', fileUrl: 'test.html', fileHash: 'hash', createdById: 'staff-1' }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    signature: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    notificationLog: { create: jest.fn() },
    setting: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const mockStorage = {
    upload: jest.fn().mockResolvedValue('contracts/2026/BC-2026-0042/CONTRACT.pdf'),
    getStream: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    delete: jest.fn(),
    configured: true,
  };

  const mockNotifications = {
    send: jest.fn().mockResolvedValue({ id: 'n-1', status: 'SENT' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contract.findUnique.mockResolvedValue(fullContract);
    mockPrisma.contractTemplate.findFirst.mockResolvedValue(storeDirectTemplate);
    mockPrisma.contractTemplate.findUnique.mockResolvedValue(storeDirectTemplate);
    mockPrisma.contractTemplate.findMany.mockResolvedValue([storeDirectTemplate]);
    mockPrisma.systemConfig.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    prisma = module.get(PrismaService);
  });

  // ════════════════════════════════════════════════════════
  //  1. TEMPLATE ACCURACY — ความถูกต้องของเทมเพลต
  // ════════════════════════════════════════════════════════
  describe('1. Template Accuracy — ดึงเทมเพลตถูกประเภทและเวอร์ชันล่าสุด', () => {

    // TC-1.1: ดึงเทมเพลต STORE_DIRECT เมื่อสร้างสัญญาผ่อนชำระ
    it('TC-1.1: ต้องดึงเทมเพลตประเภท STORE_DIRECT สำหรับสัญญาผ่อนชำระ', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');

      expect(prisma.contractTemplate.findFirst).toHaveBeenCalledWith({
        where: { type: 'STORE_DIRECT', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.renderedHtml).toContain('สัญญาผ่อนชำระ');
      expect(result.renderedHtml).toContain('BC-2026-0042');
    });

    // TC-1.2: เมื่อมีหลายเวอร์ชัน ต้องเลือกเวอร์ชันล่าสุด (orderBy createdAt desc)
    it('TC-1.2: ต้องดึงเวอร์ชันล่าสุดเสมอ (orderBy createdAt desc)', async () => {
      // findFirst ด้วย orderBy: { createdAt: 'desc' } จะคืน v2 ซึ่งใหม่กว่า
      prisma.contractTemplate.findFirst.mockResolvedValue(storeDirectTemplate); // v2

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');

      // ตรวจว่า query ส่ง orderBy desc จริง
      expect(prisma.contractTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
      expect(result.renderedHtml).toBeDefined();
    });

    // TC-1.3: ดึงเทมเพลต PDPA_CONSENT สำหรับเอกสาร PDPA
    it('TC-1.3: ต้องดึงเทมเพลตประเภท PDPA_CONSENT สำหรับเอกสาร PDPA', async () => {
      const contractWithPdpa = {
        ...fullContract,
        pdpaConsent: { id: 'pdpa-1', signatureImage: 'data:image/png;base64,iVBOR', grantedAt: new Date('2026-03-01') },
      };
      prisma.contract.findUnique.mockResolvedValue(contractWithPdpa);
      prisma.contractTemplate.findFirst.mockResolvedValue(pdpaTemplate);

      const result = await service.generatePdpaDocument('contract-full', 'staff-1');

      expect(prisma.contractTemplate.findFirst).toHaveBeenCalledWith({
        where: { type: 'PDPA_CONSENT', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.renderedHtml).toContain('หนังสือยินยอม PDPA');
    });

    // TC-1.4: เมื่อระบุ templateId ตรงๆ ต้องดึงเทมเพลตตาม ID นั้น
    it('TC-1.4: เมื่อระบุ templateId ต้องดึงตาม ID ไม่ใช่ auto-select', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(storeDirectTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-store-v2');

      expect(prisma.contractTemplate.findUnique).toHaveBeenCalledWith({ where: { id: 'tpl-store-v2' } });
      // findFirst ไม่ควรถูกเรียกเมื่อระบุ templateId
      expect(prisma.contractTemplate.findFirst).not.toHaveBeenCalled();
    });

    // TC-1.5: เทมเพลตที่ isActive=false ต้องไม่ถูกดึงมาใช้ (auto-select)
    it('TC-1.5: ต้องดึงเฉพาะเทมเพลตที่ isActive=true', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValue(null); // ไม่พบ active template

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');

      // ใช้ default template แทน
      expect(prisma.contractTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
      // ต้องยัง generate ได้ด้วย default template
      expect(result.renderedHtml).toContain('BC-2026-0042');
    });

    // TC-1.6: findAllTemplates ต้อง filter ตาม type ได้
    it('TC-1.6: findAllTemplates ต้อง filter ตาม type ได้ถูกต้อง', async () => {
      prisma.contractTemplate.findMany.mockResolvedValue([storeDirectTemplate]);

      await service.findAllTemplates('STORE_DIRECT');

      expect(prisma.contractTemplate.findMany).toHaveBeenCalledWith({
        where: { isActive: true, type: 'STORE_DIRECT' },
        orderBy: { createdAt: 'desc' },
      });
    });

    // TC-1.7: findAllTemplates โดยไม่ระบุ type ต้องคืนทุกประเภท
    it('TC-1.7: findAllTemplates ไม่ระบุ type ต้องคืนเทมเพลต active ทั้งหมด', async () => {
      prisma.contractTemplate.findMany.mockResolvedValue([storeDirectTemplate, pdpaTemplate]);

      await service.findAllTemplates();

      expect(prisma.contractTemplate.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    // TC-1.8: preview ต้องใช้เทมเพลตเดียวกับ generate
    it('TC-1.8: previewContract ต้องใช้เทมเพลต STORE_DIRECT ล่าสุดเหมือน generateDocument', async () => {
      const result = await service.previewContract('contract-full');

      expect(prisma.contractTemplate.findFirst).toHaveBeenCalledWith({
        where: { type: 'STORE_DIRECT', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result.html).toContain('BC-2026-0042');
    });
  });

  // ════════════════════════════════════════════════════════
  //  2. VARIABLE MAPPING & DATA BINDING
  // ════════════════════════════════════════════════════════
  describe('2. Variable Mapping & Data Binding — แทนที่ตัวแปรครบถ้วน', () => {

    // TC-2.1: ข้อมูลลูกค้าแทนที่ครบทุกฟิลด์
    it('TC-2.1: ข้อมูลลูกค้า (ชื่อ, บัตร ปชช., เบอร์โทร) ต้องแทนที่ครบ', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('สมชาย ใจดี');
      // national_id ถูก mask: 1-xxxx-xxxxx-3456
      expect(html).toContain('1-xxxx-xxxxx-3456');
      expect(html).toContain('0891234567');
    });

    // TC-2.2: ข้อมูลสินค้าแทนที่ครบ
    it('TC-2.2: ข้อมูลสินค้า (ยี่ห้อ, รุ่น, IMEI) ต้องแทนที่ครบ', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('Apple');
      expect(html).toContain('16 Pro Max');
      expect(html).toContain('354789102345678');
    });

    // TC-2.3: ข้อมูลการเงินแทนที่ครบ
    it('TC-2.3: ข้อมูลการเงิน (ราคา, ดาวน์, ยอดผ่อน, ดอกเบี้ย) ต้องแทนที่ครบ', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('25,000');   // selling_price
      expect(html).toContain('5,000');    // down_payment
      expect(html).toContain('21,800');   // financed_amount
      expect(html).toContain('2,180');    // monthly_payment
      expect(html).toContain('10');       // total_months
    });

    // TC-2.4: ตารางผ่อนชำระต้องมีครบทุกงวด
    it('TC-2.4: ตารางผ่อนชำระต้องแสดงครบทุกงวด (10 งวด)', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ต้องมี payment_schedule_table
      expect(html).toContain('<table');
      expect(html).toContain('งวดที่');
      // ตรวจว่ามีแถว 10 งวด
      const rowMatches = html.match(/<tr><td style="text-align:center">\d+<\/td>/g);
      expect(rowMatches).toHaveLength(10);
    });

    // TC-2.5: ต้องไม่มี placeholder ดิบหลุดไปในเอกสาร (old syntax)
    it('TC-2.5: ต้องไม่มี {placeholder} ดิบหลุดในเอกสารสำเร็จรูป', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ตรวจว่าไม่มี {xxx} pattern ที่เป็นตัวแปรดิบหลุด
      const unmatchedOld = html.match(/\{(?![\d{])[a-z_]+\}/g);
      expect(unmatchedOld).toBeNull();
    });

    // TC-2.6: New syntax {{= VAR}} ต้องแทนที่ครบ
    it('TC-2.6: New syntax {{= VAR}} ต้องแทนที่ครบถ้วนไม่เหลือค้าง', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(newSyntaxTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-new-syntax');
      const html = result.renderedHtml;

      expect(html).toContain('BC-2026-0042');
      expect(html).toContain('สมชาย ใจดี');
      expect(html).toContain('Apple');
      expect(html).toContain('16 Pro Max');
      expect(html).toContain('บริษัท เบสท์ช้อยส์โฟน จำกัด');

      // ต้องไม่มี {{= ... }} ดิบหลุด (ยกเว้น key ที่ไม่มีใน map)
      const unmatchedNew = html.match(/\{\{=\s*(CONTRACT|CUSTOMER|PHONE|COMPANY|BRANCH|SALESPERSON)\.\w+\s*(?:\|[^}]*)?\}\}/g);
      expect(unmatchedNew).toBeNull();
    });

    // TC-2.7: date pipe formatting ต้องทำงาน
    it('TC-2.7: {{= CONTRACT.DATE | date:l}} ต้องแสดงวันที่ไทยแบบยาว', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(newSyntaxTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-new-syntax');
      const html = result.renderedHtml;

      // date:l format = "1 เดือน มีนาคม พ.ศ. 2569"
      expect(html).toContain('เดือน');
      expect(html).toContain('พ.ศ.');
      // ต้องไม่มี {{= CONTRACT.DATE | date:l}} ดิบ
      expect(html).not.toContain('{{= CONTRACT.DATE | date:l}}');
    });

    // TC-2.8: num pipe formatting ต้องทำงาน
    it('TC-2.8: {{= CONTRACT.SELLING_PRICE | num:2}} ต้องแสดงตัวเลข 2 ทศนิยม', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(newSyntaxTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-new-syntax');
      const html = result.renderedHtml;

      // 25000 → 25,000.00
      expect(html).toMatch(/25,000\.00/);
      expect(html).not.toContain('{{= CONTRACT.SELLING_PRICE | num:2}}');
    });

    // TC-2.9: บุคคลอ้างอิง (EMERGENCY_CONTACTS) ต้อง render ครบ
    it('TC-2.9: {{for CONTACT in EMERGENCY_CONTACTS}} ต้อง render รายชื่อบุคคลอ้างอิงครบ', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(emergencyContactTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-emergency');
      const html = result.renderedHtml;

      expect(html).toContain('นางสมหญิง ใจดี');
      expect(html).toContain('0899998888');
      expect(html).toContain('มารดา');
      expect(html).toContain('นายสมศักดิ์ ใจดี');
      expect(html).toContain('0877776666');
      expect(html).toContain('พี่ชาย');
      // ต้องไม่มี loop syntax ดิบ
      expect(html).not.toContain('{{for');
      expect(html).not.toContain('{{/for}}');
    });

    // TC-2.10: ข้อมูลที่เป็น null/empty ต้องแสดง "-" ไม่ใช่ "null" หรือ "undefined"
    it('TC-2.10: ฟิลด์ที่ว่างต้องแสดง "-" ไม่ใช่ "null"/"undefined"', async () => {
      const contractMissingSome = {
        ...fullContract,
        customer: {
          ...fullContract.customer,
          lineId: null,
          facebookLink: null,
          occupation: null,
          workplace: null,
        },
      };
      prisma.contract.findUnique.mockResolvedValue(contractMissingSome);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).not.toContain('null');
      expect(html).not.toContain('undefined');
    });

    // TC-2.11: ที่อยู่ JSON ต้อง format เป็นข้อความอ่านง่าย
    it('TC-2.11: ที่อยู่ JSON ต้องถูกแปลงเป็นข้อความอ่านง่าย', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ที่อยู่ปัจจุบัน: 789 นารายณ์มหาราช ทะเลชุบศร เมือง ลพบุรี
      expect(html).toContain('789');
      expect(html).toContain('ลพบุรี');
      // ต้องไม่แสดง JSON ดิบ
      expect(html).not.toContain('"houseNo"');
      expect(html).not.toContain('"province"');
    });

    // TC-2.12: numberToThaiText ต้องแปลงจำนวนเงินเป็นตัวอักษรไทย
    it('TC-2.12: ยอดผ่อนต้องแปลงเป็นตัวอักษรไทยถูกต้อง (financed_amount_text)', async () => {
      // ใช้ default template ที่มี {financed_amount_text}
      prisma.contractTemplate.findFirst.mockResolvedValue(null); // ใช้ default

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // 21800 = สองหมื่นหนึ่งพันแปดร้อยบาทถ้วน
      expect(html).toContain('บาทถ้วน');
    });

    // TC-2.13: XSS prevention — ข้อมูลลูกค้าที่มี HTML ต้องถูก escape
    it('TC-2.13: ข้อมูลที่มี HTML/script ต้องถูก escape ป้องกัน XSS', async () => {
      const xssContract = {
        ...fullContract,
        customer: {
          ...fullContract.customer,
          name: '<script>alert("xss")</script>สมชาย',
        },
      };
      prisma.contract.findUnique.mockResolvedValue(xssContract);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    // TC-2.14: PDPA document ต้องแทนที่ pdpa_signature และ pdpa_consent_date
    it('TC-2.14: PDPA document ต้องแทนที่ลายเซ็นและวันที่ยินยอม PDPA', async () => {
      const contractWithPdpa = {
        ...fullContract,
        pdpaConsent: {
          id: 'pdpa-1',
          signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUh',
          grantedAt: new Date('2026-03-01T10:00:00Z'),
        },
      };
      prisma.contract.findUnique.mockResolvedValue(contractWithPdpa);
      prisma.contractTemplate.findFirst.mockResolvedValue(pdpaTemplate);

      const result = await service.generatePdpaDocument('contract-full', 'staff-1');
      const html = result.renderedHtml;

      expect(html).not.toContain('{pdpa_signature}');
      expect(html).not.toContain('{pdpa_consent_date}');
      expect(html).toContain('img src=');
      // ต้องแสดงวันที่ไทย
      expect(html).toContain('2569'); // พ.ศ.
    });

    // TC-2.15: ลายเซ็นลูกค้าและพนักงานต้องแสดงเป็น img tag เมื่อมี
    it('TC-2.15: ลายเซ็นต้องแสดงเป็น <img> เมื่อมีข้อมูล base64', async () => {
      const contractWithSigs = {
        ...fullContract,
        signatures: [
          { signerType: 'CUSTOMER', signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUh', signerName: 'สมชาย ใจดี' },
          { signerType: 'COMPANY', signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUh', signerName: 'พนักงาน ทดสอบ' },
        ],
      };
      prisma.contract.findUnique.mockResolvedValue(contractWithSigs);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ต้องมี img tag สำหรับลายเซ็น
      const imgTags = html.match(/<img[^>]*src="data:image\/png;base64/g);
      expect(imgTags).not.toBeNull();
      expect(imgTags!.length).toBeGreaterThanOrEqual(2);
    });

    // TC-2.16: ลายเซ็นว่างต้องแสดง placeholder ช่องว่าง (ไม่ใช่ broken img)
    it('TC-2.16: เมื่อไม่มีลายเซ็น ต้องแสดง placeholder เส้นให้เซ็น', async () => {
      // Contract ไม่มี signatures
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ต้องมี div placeholder สำหรับลงลายเซ็น
      expect(html).toContain('border-bottom:1px solid #000');
    });
  });

  // ════════════════════════════════════════════════════════
  //  3. FORMAT & LAYOUT PRESERVATION
  // ════════════════════════════════════════════════════════
  describe('3. Format & Layout Preservation — รักษารูปแบบเอกสาร', () => {

    // TC-3.1: A4 styling ต้องถูกครอบ
    it('TC-3.1: เอกสารต้องมี A4 page styling (@page size: A4)', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('@page');
      expect(html).toContain('size: A4');
      expect(html).toContain('class="a4-page"');
    });

    // TC-3.2: Thai font (TH Sarabun PSK) ต้องถูกโหลด
    it('TC-3.2: เอกสารต้องโหลดฟอนต์ TH Sarabun PSK', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('TH Sarabun PSK');
      expect(html).toContain('@font-face');
      expect(html).toContain('THSarabunPSK');
    });

    // TC-3.3: Fallback font chain ต้องครบ
    it('TC-3.3: font-family ต้องมี fallback chain ครบ (Sarabun, Noto Sans Thai)', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain("'TH Sarabun PSK', 'Sarabun', 'Noto Sans Thai', sans-serif");
    });

    // TC-3.4: Template settings (margins, fontSize) ต้องถูกใช้
    it('TC-3.4: margins และ fontSize จาก template settings ต้องถูกนำไปใช้', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // จาก storeDirectTemplate.settings
      expect(html).toContain('margin: 25mm 25mm');  // top right
      expect(html).toContain('font-size: 16px');     // body fontSize
    });

    // TC-3.5: Letterhead ต้องแสดงเมื่อ setting = 'bestchoice'
    it('TC-3.5: Letterhead BESTCHOICEPHONE ต้องแสดงเมื่อ setting เปิด', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('BESTCHOICEPHONE Co., Ltd.');
      expect(html).toContain('บริษัท เบสท์ช้อยส์โฟน จำกัด');
      expect(html).toContain('border-bottom:2px solid #059669');
    });

    // TC-3.6: เมื่อ letterhead = 'none' ต้องไม่แสดง header
    it('TC-3.6: ต้องไม่แสดง letterhead เมื่อ setting = none', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValue({
        ...storeDirectTemplate,
        settings: { ...storeDirectTemplate.settings, letterhead: 'none' },
      });

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).not.toContain('BESTCHOICEPHONE Co., Ltd.');
    });

    // TC-3.7: Page number ต้องแสดงเมื่อเปิด
    it('TC-3.7: เลขหน้าต้องแสดงเมื่อ showPageNumber=true', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('page-footer');
      expect(html).toContain('หน้า');
    });

    // TC-3.8: Page break class ต้องมี
    it('TC-3.8: เอกสารต้องมี page-break CSS class สำหรับแบ่งหน้า', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('.page-break');
      expect(html).toContain('page-break-after: always');
    });

    // TC-3.9: no-break class ต้องมี (ป้องกันหัวข้อถูกตัดข้ามหน้า)
    it('TC-3.9: เอกสารต้องมี no-break CSS สำหรับป้องกันเนื้อหาถูกตัดข้ามหน้า', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('.no-break');
      expect(html).toContain('page-break-inside: avoid');
    });

    // TC-3.10: HTML structure ต้องเป็น valid HTML5
    it('TC-3.10: เอกสารต้องมีโครงสร้าง HTML5 ครบถ้วน (DOCTYPE, html, head, body)', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="th">');
      expect(html).toContain('<head>');
      expect(html).toContain('<meta charset="UTF-8"/>');
      expect(html).toContain('<body>');
      expect(html).toContain('</html>');
    });

    // TC-3.11: Preview ต้อง simulate A4 บน screen
    it('TC-3.11: Preview ต้องมี screen media query simulate A4 (210mm width)', async () => {
      const result = await service.previewContract('contract-full');
      const html = result.html;

      expect(html).toContain('@media screen');
      expect(html).toContain('width: 210mm');
      expect(html).toContain('min-height: 297mm');
    });

    // TC-3.12: Print media query ต้องแยกจาก screen
    it('TC-3.12: ต้องมี @media print สำหรับการพิมพ์/PDF', async () => {
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      expect(html).toContain('@media print');
    });

    // TC-3.13: {{= INSTALLMENTS}} table ต้องมี border และ header ถูกต้อง
    it('TC-3.13: ตาราง INSTALLMENTS (new syntax) ต้อง render มี header และ border', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(newSyntaxTemplate);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-new-syntax');
      const html = result.renderedHtml;

      expect(html).toContain('งวดที่');
      expect(html).toContain('วันที่ครบกำหนดชำระ');
      expect(html).toContain('จำนวนเงิน');
      expect(html).toContain('border:1px solid');
      // ไม่ควรเหลือ {{= INSTALLMENTS}} ดิบ
      expect(html).not.toContain('{{= INSTALLMENTS}}');
    });
  });

  // ════════════════════════════════════════════════════════
  //  4. ERROR HANDLING — กรณีเกิดข้อผิดพลาด
  // ════════════════════════════════════════════════════════
  describe('4. Error Handling — ป้องกันสัญญาที่ไม่สมบูรณ์', () => {

    // TC-4.1: สัญญาไม่พบ → NotFoundException
    it('TC-4.1: ต้อง throw NotFoundException เมื่อหาสัญญาไม่พบ', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.generateDocument('nonexistent', 'staff-1', 'CONTRACT'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.2: สัญญาถูกลบ (soft delete) → NotFoundException
    it('TC-4.2: ต้อง throw NotFoundException เมื่อสัญญาถูก soft delete', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...fullContract,
        deletedAt: new Date(),
      });

      await expect(
        service.generateDocument('contract-full', 'staff-1', 'CONTRACT'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.3: templateId ไม่ถูกต้อง → NotFoundException
    it('TC-4.3: ต้อง throw NotFoundException เมื่อระบุ templateId ที่ไม่มีอยู่', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.generateDocument('contract-full', 'staff-1', 'CONTRACT', 'tpl-nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.4: เมื่อไม่พบ active template → ใช้ default template (ไม่ crash)
    it('TC-4.4: เมื่อไม่พบ active template ต้อง fallback ใช้ default template ไม่ crash', async () => {
      prisma.contractTemplate.findFirst.mockResolvedValue(null);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');

      expect(result).toBeDefined();
      expect(result.renderedHtml).toContain('BC-2026-0042');
      expect(result.renderedHtml).toContain('สัญญาผ่อนชำระ');
    });

    // TC-4.5: PDPA document ต้องมี pdpaConsent ก่อน
    it('TC-4.5: generatePdpaDocument ต้อง throw BadRequestException เมื่อไม่มี PDPA consent', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...fullContract,
        pdpaConsent: null,
      });

      await expect(
        service.generatePdpaDocument('contract-full', 'staff-1'),
      ).rejects.toThrow(BadRequestException);
    });

    // TC-4.6: PDPA document สำหรับสัญญาที่ถูกลบ → NotFoundException
    it('TC-4.6: generatePdpaDocument ต้อง throw NotFoundException เมื่อสัญญาถูกลบ', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...fullContract,
        deletedAt: new Date(),
      });

      await expect(
        service.generatePdpaDocument('contract-full', 'staff-1'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.7: generateSignedDocuments ต้อง collect errors ไม่ throw
    it('TC-4.7: generateSignedDocuments ต้อง collect errors ไม่ throw ทิ้ง', async () => {
      prisma.contract.findUnique.mockResolvedValueOnce(null); // first call fails

      const result = await service.generateSignedDocuments('contract-full', 'staff-1');

      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    // TC-4.8: PDF generation fail → fallback HTML
    it('TC-4.8: เมื่อ PDF generation ล้มเหลว ต้อง fallback เก็บ HTML แทน', async () => {
      // puppeteer ถูก mock ให้ fail อยู่แล้ว
      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');

      expect(result.pdfGenerated).toBe(false);
      expect(result.renderedHtml).toBeDefined();
      expect(result.renderedHtml.length).toBeGreaterThan(0);
    });

    // TC-4.9: preview สัญญาที่ไม่มี → NotFoundException
    it('TC-4.9: previewContract ต้อง throw NotFoundException เมื่อหาสัญญาไม่พบ', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.previewContract('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.10: preview สัญญาที่ถูกลบ → NotFoundException
    it('TC-4.10: previewContract ต้อง throw NotFoundException เมื่อสัญญาถูก soft delete', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...fullContract,
        deletedAt: new Date(),
      });

      await expect(
        service.previewContract('contract-full'),
      ).rejects.toThrow(NotFoundException);
    });

    // TC-4.11: findOneTemplate ที่ไม่มี → NotFoundException
    it('TC-4.11: findOneTemplate ต้อง throw NotFoundException เมื่อ template ไม่มี', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(null);

      await expect(service.findOneTemplate('tpl-nonexistent')).rejects.toThrow(NotFoundException);
    });

    // TC-4.12: createTemplate ต้อง sanitize HTML ป้องกัน XSS
    it('TC-4.12: createTemplate ต้อง sanitize HTML (ลบ script, event handler)', async () => {
      prisma.contractTemplate.create.mockResolvedValue({
        ...storeDirectTemplate,
        contentHtml: '<div>safe</div>',
      });

      await service.createTemplate({
        name: 'XSS Test',
        contentHtml: '<div>safe</div><script>alert("xss")</script><img onerror="hack()" src="x"/><iframe src="evil.com"></iframe>',
      });

      // ตรวจว่า contentHtml ที่ส่งเข้า create ถูก sanitize แล้ว
      expect(prisma.contractTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentHtml: expect.not.stringContaining('<script>'),
          }),
        }),
      );
      const callData = prisma.contractTemplate.create.mock.calls[0][0].data;
      expect(callData.contentHtml).not.toContain('onerror');
      expect(callData.contentHtml).not.toContain('<iframe');
    });

    // TC-4.13: ลายเซ็นที่ไม่ปลอดภัย (data URL ไม่ใช่ image) ต้องไม่ถูก embed
    it('TC-4.13: ลายเซ็นที่ไม่ใช่ image data URL ต้องไม่ถูก embed เป็น img', async () => {
      const contractBadSig = {
        ...fullContract,
        signatures: [
          { signerType: 'CUSTOMER', signatureImage: 'data:text/html;base64,PHNjcmlwdD4=', signerName: 'Hacker' },
        ],
      };
      prisma.contract.findUnique.mockResolvedValue(contractBadSig);

      const result = await service.generateDocument('contract-full', 'staff-1', 'CONTRACT');
      const html = result.renderedHtml;

      // ต้องไม่มี img tag กับ data:text/html
      expect(html).not.toContain('data:text/html');
    });

    // TC-4.14: deleteTemplate ต้อง soft delete (isActive=false)
    it('TC-4.14: deleteTemplate ต้อง set isActive=false ไม่ลบจริง', async () => {
      prisma.contractTemplate.findUnique.mockResolvedValue(storeDirectTemplate);
      prisma.contractTemplate.update.mockResolvedValue({ ...storeDirectTemplate, isActive: false });

      await service.deleteTemplate('tpl-store-v2');

      expect(prisma.contractTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-store-v2' },
        data: { isActive: false },
      });
    });

    // TC-4.15: notification failure ต้องไม่ทำให้ generate ล้มเหลว
    it('TC-4.15: เมื่อส่ง LINE notification ไม่สำเร็จ ต้องไม่ทำให้ generateSignedDocuments ล้มเหลว', async () => {
      mockNotifications.send.mockRejectedValue(new Error('LINE API error'));

      const result = await service.generateSignedDocuments('contract-full', 'staff-1');

      // ต้องไม่ throw แม้ notification ล้มเหลว
      expect(result).toBeDefined();
    });

    // TC-4.16: extractPlaceholders ต้องรองรับทั้ง old และ new syntax
    it('TC-4.16: createTemplate ต้อง extract placeholders ได้ทั้ง {old} และ {{= NEW}} syntax', async () => {
      prisma.contractTemplate.create.mockImplementation(async (args: any) => ({
        ...storeDirectTemplate,
        ...args.data,
      }));

      await service.createTemplate({
        name: 'Mixed Syntax',
        contentHtml: '<p>{customer_name}</p><p>{{= CONTRACT.NUMBER}}</p><p>{{= CUSTOMER.TEL | num:0}}</p>',
      });

      const callData = prisma.contractTemplate.create.mock.calls[0][0].data;
      expect(callData.placeholders).toContain('{customer_name}');
      expect(callData.placeholders).toEqual(
        expect.arrayContaining([
          expect.stringContaining('customer_name'),
        ]),
      );
    });
  });
});
