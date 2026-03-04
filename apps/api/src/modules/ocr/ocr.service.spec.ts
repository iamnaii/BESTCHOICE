import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { OcrService } from './ocr.service';

// Mock Anthropic SDK
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

describe('OcrService', () => {
  let service: OcrService;

  const validBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  // ─── Helper ─────────────────────────────────────────────

  const makeMockResponse = (json: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  });

  beforeEach(async () => {
    mockCreate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ANTHROPIC_API_KEY') return 'test-api-key';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
  });

  // ═══════════════════════════════════════════════════════
  //  ID Card Tests
  // ═══════════════════════════════════════════════════════

  describe('extractIdCard', () => {
    const sampleOcrResponse = {
      nationalId: '3430600120504',
      prefix: 'นางสาว',
      firstName: 'วันนี',
      lastName: 'แววศรี',
      birthDate: '1978-10-30',
      address: '11/2 หมู่ที่ 9 ต.ดงมะรุม อ.โคกสำโรง จ.ลพบุรี',
      addressStructured: {
        houseNo: '11/2',
        moo: '9',
        village: '',
        soi: '',
        road: '',
        subdistrict: 'ดงมะรุม',
        district: 'โคกสำโรง',
        province: 'ลพบุรี',
        postalCode: '15120',
      },
      issueDate: '2024-11-29',
      expiryDate: '2033-10-29',
      confidence: 0.92,
    };

    it('should extract ID card data successfully', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleOcrResponse));

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('3430600120504');
      expect(result.prefix).toBe('นางสาว');
      expect(result.firstName).toBe('วันนี');
      expect(result.lastName).toBe('แววศรี');
      expect(result.fullName).toBe('วันนี แววศรี');
      expect(result.birthDate).toBe('1978-10-30');
      expect(result.issueDate).toBe('2024-11-29');
      expect(result.expiryDate).toBe('2033-10-29');
      expect(result.confidence).toBe(0.92);
      expect(result.nationalIdValid).toBe(true);
    });

    it('should return nationalIdValid false for invalid checksum', async () => {
      const badId = { ...sampleOcrResponse, nationalId: '1234567890123' };
      mockCreate.mockResolvedValue(makeMockResponse(badId));

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('1234567890123');
      expect(result.nationalIdValid).toBe(false);
    });

    it('should parse structured address correctly', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleOcrResponse));

      const result = await service.extractIdCard(validBase64);

      expect(result.addressStructured).not.toBeNull();
      expect(result.addressStructured!.houseNo).toBe('11/2');
      expect(result.addressStructured!.moo).toBe('9');
      expect(result.addressStructured!.subdistrict).toBe('ดงมะรุม');
      expect(result.addressStructured!.district).toBe('โคกสำโรง');
      expect(result.addressStructured!.province).toBe('ลพบุรี');
      expect(result.addressStructured!.postalCode).toBe('15120');
    });

    it('should handle JSON wrapped in markdown code fences', async () => {
      const wrappedResponse = {
        content: [
          {
            type: 'text',
            text: '```json\n' + JSON.stringify(sampleOcrResponse) + '\n```',
          },
        ],
      };
      mockCreate.mockResolvedValue(wrappedResponse);

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('3430600120504');
      expect(result.firstName).toBe('วันนี');
    });

    it('should handle JSON with trailing commas', async () => {
      const jsonWithTrailingComma = `{
        "nationalId": "3430600120504",
        "prefix": "นางสาว",
        "firstName": "วันนี",
        "lastName": "แววศรี",
        "birthDate": "1978-10-30",
        "address": "11/2 หมู่ที่ 9",
        "addressStructured": null,
        "issueDate": "2024-11-29",
        "expiryDate": "2033-10-29",
        "confidence": 0.85,
      }`;
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: jsonWithTrailingComma }],
      });

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('3430600120504');
      expect(result.confidence).toBe(0.85);
    });

    it('should clean dashes and spaces from national ID', async () => {
      const responseWithDashes = {
        ...sampleOcrResponse,
        nationalId: '3-4306-00120-50-4',
      };
      mockCreate.mockResolvedValue(makeMockResponse(responseWithDashes));

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('3430600120504');
    });

    it('should return null for invalid dates', async () => {
      const responseWithBadDates = {
        ...sampleOcrResponse,
        birthDate: '2521-10-30',
        issueDate: '2024-13-29',
        expiryDate: '2033-02-30',
      };
      mockCreate.mockResolvedValue(makeMockResponse(responseWithBadDates));

      const result = await service.extractIdCard(validBase64);

      expect(result.issueDate).toBeNull();
      expect(result.expiryDate).toBeNull();
    });

    it('should clamp confidence between 0 and 1', async () => {
      const highConfidence = { ...sampleOcrResponse, confidence: 5.0 };
      mockCreate.mockResolvedValue(makeMockResponse(highConfidence));

      const result = await service.extractIdCard(validBase64);
      expect(result.confidence).toBe(1);
    });

    it('should default confidence to 0.5 when missing', async () => {
      const noConfidence = { ...sampleOcrResponse, confidence: undefined };
      mockCreate.mockResolvedValue(makeMockResponse(noConfidence));

      const result = await service.extractIdCard(validBase64);
      expect(result.confidence).toBe(0.5);
    });

    it('should set addressStructured to null when all fields are empty', async () => {
      const emptyAddr = {
        ...sampleOcrResponse,
        addressStructured: {
          houseNo: '',
          moo: '',
          village: '',
          soi: '',
          road: '',
          subdistrict: '',
          district: '',
          province: '',
          postalCode: '',
        },
      };
      mockCreate.mockResolvedValue(makeMockResponse(emptyAddr));

      const result = await service.extractIdCard(validBase64);
      expect(result.addressStructured).toBeNull();
    });

    it('should return null fields when data is missing', async () => {
      const minimalResponse = {
        nationalId: null,
        prefix: null,
        firstName: null,
        lastName: null,
        birthDate: null,
        address: null,
        addressStructured: null,
        issueDate: null,
        expiryDate: null,
        confidence: 0.3,
      };
      mockCreate.mockResolvedValue(makeMockResponse(minimalResponse));

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBeNull();
      expect(result.prefix).toBeNull();
      expect(result.firstName).toBeNull();
      expect(result.lastName).toBeNull();
      expect(result.fullName).toBeNull();
      expect(result.birthDate).toBeNull();
      expect(result.address).toBeNull();
      expect(result.addressStructured).toBeNull();
    });

    // --- Validation / rejection tests ---

    it('should reject non-data-URL input', async () => {
      await expect(
        service.extractIdCard('https://example.com/image.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsupported image types', async () => {
      await expect(
        service.extractIdCard('data:image/svg+xml;base64,PHN2Zz4='),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-image data URLs', async () => {
      await expect(
        service.extractIdCard('data:application/pdf;base64,JVBERi0='),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when Anthropic returns unparseable response', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ไม่สามารถอ่านข้อมูลจากบัตรได้' }],
      });

      await expect(service.extractIdCard(validBase64)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw InternalServerError when Anthropic returns no text content', async () => {
      mockCreate.mockResolvedValue({ content: [] });

      await expect(service.extractIdCard(validBase64)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should reject invalid base64 characters', async () => {
      await expect(
        service.extractIdCard('data:image/jpeg;base64,<script>alert(1)</script>'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('extractIdCard without API key', () => {
    it('should throw when ANTHROPIC_API_KEY is not configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      const serviceWithoutKey = module.get<OcrService>(OcrService);

      await expect(
        serviceWithoutKey.extractIdCard('data:image/jpeg;base64,/9j/4A=='),
      ).rejects.toThrow('ไม่ได้ตั้งค่า API Key');
    });
  });

  describe('validateNationalId (via extractIdCard)', () => {
    it('should accept valid Thai national ID with correct checksum', async () => {
      const response = {
        nationalId: '3430600120504',
        prefix: 'นางสาว',
        firstName: 'วันนี',
        lastName: 'แววศรี',
        birthDate: '1978-10-30',
        address: '11/2',
        addressStructured: null,
        issueDate: '2024-11-29',
        expiryDate: '2033-10-29',
        confidence: 0.92,
      };
      mockCreate.mockResolvedValue(makeMockResponse(response));

      const result = await service.extractIdCard(
        'data:image/jpeg;base64,/9j/4A==',
      );
      expect(result.nationalId).toBe('3430600120504');
    });
  });

  // Bangkok-style ID card
  describe('extractIdCard — Bangkok address card', () => {
    const bangkokCardResponse = {
      nationalId: '1100703971635',
      prefix: 'นาย',
      firstName: 'ชิณวัตร',
      lastName: 'ลีนิวัตร',
      birthDate: '1999-07-15',
      address: '153 ซ.เพชรบุรี 5 ถ.เพชรบุรี แขวงทุ่งพญาไท เขตราชเทวี กรุงเทพมหานคร',
      addressStructured: {
        houseNo: '153',
        moo: '',
        village: '',
        soi: 'เพชรบุรี 5',
        road: 'เพชรบุรี',
        subdistrict: 'ทุ่งพญาไท',
        district: 'ราชเทวี',
        province: 'กรุงเทพมหานคร',
        postalCode: '10400',
      },
      issueDate: '2022-04-22',
      expiryDate: '2029-07-14',
      confidence: 0.88,
    };

    it('should extract Bangkok-style card data successfully', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(bangkokCardResponse));

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('1100703971635');
      expect(result.nationalIdValid).toBe(true);
      expect(result.prefix).toBe('นาย');
      expect(result.firstName).toBe('ชิณวัตร');
      expect(result.lastName).toBe('ลีนิวัตร');
      expect(result.fullName).toBe('ชิณวัตร ลีนิวัตร');
      expect(result.confidence).toBe(0.88);
    });

    it('should parse Bangkok structured address correctly', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(bangkokCardResponse));

      const result = await service.extractIdCard(validBase64);

      expect(result.addressStructured!.subdistrict).toBe('ทุ่งพญาไท');
      expect(result.addressStructured!.district).toBe('ราชเทวี');
      expect(result.addressStructured!.province).toBe('กรุงเทพมหานคร');
      expect(result.addressStructured!.postalCode).toBe('10400');
    });

    it('should handle code fences + trailing commas + dashed nationalId', async () => {
      const messyJson = '```json\n' + JSON.stringify({
        ...bangkokCardResponse,
        nationalId: '1-1007-03971-63-5',
      }).replace(/"confidence":0.88}/, '"confidence":0.88,}') + '\n```';

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: messyJson }],
      });

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('1100703971635');
      expect(result.nationalIdValid).toBe(true);
      expect(result.firstName).toBe('ชิณวัตร');
    });
  });

  // ═══════════════════════════════════════════════════════
  //  Payment Slip Tests
  // ═══════════════════════════════════════════════════════

  describe('extractPaymentSlip', () => {
    const sampleSlipResponse = {
      amount: 5000,
      senderName: 'นาย ทดสอบ ระบบ',
      senderBank: 'กสิกรไทย',
      senderAccountNo: '0123456789',
      receiverName: 'BESTCHOICE CO LTD',
      receiverBank: 'กรุงเทพ',
      receiverAccountNo: '9876543210',
      transactionRef: 'TXN20240315001234',
      transactionDate: '2024-03-15',
      transactionTime: '14:30',
      slipType: 'BANK_TRANSFER',
      confidence: 0.9,
    };

    it('should extract payment slip data successfully', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleSlipResponse));

      const result = await service.extractPaymentSlip(validBase64);

      expect(result.amount).toBe(5000);
      expect(result.senderName).toBe('นาย ทดสอบ ระบบ');
      expect(result.senderBank).toBe('กสิกรไทย');
      expect(result.receiverName).toBe('BESTCHOICE CO LTD');
      expect(result.transactionRef).toBe('TXN20240315001234');
      expect(result.transactionDate).toBe('2024-03-15');
      expect(result.transactionTime).toBe('14:30');
      expect(result.slipType).toBe('BANK_TRANSFER');
      expect(result.confidence).toBe(0.9);
    });

    it('should parse amount with comma formatting', async () => {
      const resp = { ...sampleSlipResponse, amount: '5,000.50' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.amount).toBe(5000.5);
    });

    it('should handle PromptPay slip type', async () => {
      const resp = { ...sampleSlipResponse, slipType: 'PROMPTPAY', receiverAccountNo: '0812345678' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.slipType).toBe('PROMPTPAY');
      expect(result.receiverAccountNo).toBe('0812345678');
    });

    it('should handle QR_PAYMENT slip type', async () => {
      const resp = { ...sampleSlipResponse, slipType: 'QR_PAYMENT' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.slipType).toBe('QR_PAYMENT');
    });

    it('should set null for invalid slip type', async () => {
      const resp = { ...sampleSlipResponse, slipType: 'INVALID_TYPE' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.slipType).toBeNull();
    });

    it('should truncate time to HH:mm format', async () => {
      const resp = { ...sampleSlipResponse, transactionTime: '14:30:45' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.transactionTime).toBe('14:30');
    });

    it('should return null for invalid date format', async () => {
      const resp = { ...sampleSlipResponse, transactionDate: '15/03/2024' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.transactionDate).toBeNull();
    });

    it('should return null amount for zero or negative values', async () => {
      const resp = { ...sampleSlipResponse, amount: 0 };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractPaymentSlip(validBase64);
      expect(result.amount).toBeNull();
    });

    it('should handle null fields gracefully', async () => {
      const minimalResp = {
        amount: null,
        senderName: null,
        senderBank: null,
        senderAccountNo: null,
        receiverName: null,
        receiverBank: null,
        receiverAccountNo: null,
        transactionRef: null,
        transactionDate: null,
        transactionTime: null,
        slipType: null,
        confidence: 0.3,
      };
      mockCreate.mockResolvedValue(makeMockResponse(minimalResp));

      const result = await service.extractPaymentSlip(validBase64);

      expect(result.amount).toBeNull();
      expect(result.senderName).toBeNull();
      expect(result.transactionRef).toBeNull();
      expect(result.slipType).toBeNull();
      expect(result.confidence).toBe(0.3);
    });

    it('should reject non-data-URL input for slip', async () => {
      await expect(
        service.extractPaymentSlip('https://example.com/slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest when API returns unparseable response', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ไม่สามารถอ่านสลิปได้' }],
      });

      await expect(service.extractPaymentSlip(validBase64)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  //  Book Bank Tests
  // ═══════════════════════════════════════════════════════

  describe('extractBookBank', () => {
    const sampleBookBankResponse = {
      accountName: 'นาย ทดสอบ ระบบ',
      accountNo: '0123456789',
      bankName: 'กสิกรไทย',
      branchName: 'สาขาเซ็นทรัลเวิลด์',
      accountType: 'ออมทรัพย์',
      balance: 125000.5,
      lastTransactionDate: '2024-03-10',
      confidence: 0.85,
    };

    it('should extract book bank data successfully', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleBookBankResponse));

      const result = await service.extractBookBank(validBase64);

      expect(result.accountName).toBe('นาย ทดสอบ ระบบ');
      expect(result.accountNo).toBe('0123456789');
      expect(result.bankName).toBe('กสิกรไทย');
      expect(result.branchName).toBe('สาขาเซ็นทรัลเวิลด์');
      expect(result.accountType).toBe('ออมทรัพย์');
      expect(result.balance).toBe(125000.5);
      expect(result.lastTransactionDate).toBe('2024-03-10');
      expect(result.confidence).toBe(0.85);
    });

    it('should clean dashes and spaces from account number', async () => {
      const resp = { ...sampleBookBankResponse, accountNo: '012-3-456-789' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractBookBank(validBase64);
      expect(result.accountNo).toBe('0123456789');
    });

    it('should parse balance from string with commas', async () => {
      const resp = { ...sampleBookBankResponse, balance: '125,000.50' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractBookBank(validBase64);
      expect(result.balance).toBe(125000.5);
    });

    it('should handle null balance', async () => {
      const resp = { ...sampleBookBankResponse, balance: null };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractBookBank(validBase64);
      expect(result.balance).toBeNull();
    });

    it('should return null for invalid lastTransactionDate', async () => {
      const resp = { ...sampleBookBankResponse, lastTransactionDate: '10 มี.ค. 67' };
      mockCreate.mockResolvedValue(makeMockResponse(resp));

      const result = await service.extractBookBank(validBase64);
      expect(result.lastTransactionDate).toBeNull();
    });

    it('should handle null fields gracefully', async () => {
      const minimalResp = {
        accountName: null,
        accountNo: null,
        bankName: null,
        branchName: null,
        accountType: null,
        balance: null,
        lastTransactionDate: null,
        confidence: 0.4,
      };
      mockCreate.mockResolvedValue(makeMockResponse(minimalResp));

      const result = await service.extractBookBank(validBase64);

      expect(result.accountName).toBeNull();
      expect(result.accountNo).toBeNull();
      expect(result.bankName).toBeNull();
      expect(result.balance).toBeNull();
      expect(result.confidence).toBe(0.4);
    });

    it('should reject non-image input', async () => {
      await expect(
        service.extractBookBank('https://example.com/bankbook.jpg'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════════════
  //  Driving License Tests
  // ═══════════════════════════════════════════════════════

  describe('extractDrivingLicense', () => {
    const sampleDLResponse = {
      licenseNo: '12345678',
      nationalId: '3430600120504',
      prefix: 'นาย',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      birthDate: '1990-05-15',
      address: '123 ม.5 ต.ท่าทอง อ.เมือง จ.สุราษฎร์ธานี 84000',
      addressStructured: {
        houseNo: '123',
        moo: '5',
        village: '',
        soi: '',
        road: '',
        subdistrict: 'ท่าทอง',
        district: 'เมือง',
        province: 'สุราษฎร์ธานี',
        postalCode: '84000',
      },
      licenseType: 'ส่วนบุคคล',
      issueDate: '2023-06-01',
      expiryDate: '2028-05-31',
      bloodType: 'O',
      confidence: 0.87,
    };

    it('should extract driving license data successfully', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleDLResponse));

      const result = await service.extractDrivingLicense(validBase64);

      expect(result.licenseNo).toBe('12345678');
      expect(result.nationalId).toBe('3430600120504');
      expect(result.nationalIdValid).toBe(true);
      expect(result.prefix).toBe('นาย');
      expect(result.firstName).toBe('สมชาย');
      expect(result.lastName).toBe('ใจดี');
      expect(result.fullName).toBe('สมชาย ใจดี');
      expect(result.birthDate).toBe('1990-05-15');
      expect(result.licenseType).toBe('ส่วนบุคคล');
      expect(result.issueDate).toBe('2023-06-01');
      expect(result.expiryDate).toBe('2028-05-31');
      expect(result.bloodType).toBe('O');
      expect(result.confidence).toBe(0.87);
    });

    it('should parse structured address from DL', async () => {
      mockCreate.mockResolvedValue(makeMockResponse(sampleDLResponse));

      const result = await service.extractDrivingLicense(validBase64);

      expect(result.addressStructured).not.toBeNull();
      expect(result.addressStructured!.houseNo).toBe('123');
      expect(result.addressStructured!.moo).toBe('5');
      expect(result.addressStructured!.subdistrict).toBe('ท่าทอง');
      expect(result.addressStructured!.district).toBe('เมือง');
      expect(result.addressStructured!.province).toBe('สุราษฎร์ธานี');
    });

    it('should validate national ID checksum on DL', async () => {
      const badIdDL = { ...sampleDLResponse, nationalId: '9999999999999' };
      mockCreate.mockResolvedValue(makeMockResponse(badIdDL));

      const result = await service.extractDrivingLicense(validBase64);
      expect(result.nationalIdValid).toBe(false);
    });

    it('should clean dashes from national ID on DL', async () => {
      const dashedDL = { ...sampleDLResponse, nationalId: '3-4306-00120-50-4' };
      mockCreate.mockResolvedValue(makeMockResponse(dashedDL));

      const result = await service.extractDrivingLicense(validBase64);
      expect(result.nationalId).toBe('3430600120504');
      expect(result.nationalIdValid).toBe(true);
    });

    it('should handle null fields gracefully', async () => {
      const minimalResp = {
        licenseNo: null,
        nationalId: null,
        prefix: null,
        firstName: null,
        lastName: null,
        birthDate: null,
        address: null,
        addressStructured: null,
        licenseType: null,
        issueDate: null,
        expiryDate: null,
        bloodType: null,
        confidence: 0.5,
      };
      mockCreate.mockResolvedValue(makeMockResponse(minimalResp));

      const result = await service.extractDrivingLicense(validBase64);

      expect(result.licenseNo).toBeNull();
      expect(result.nationalId).toBeNull();
      expect(result.nationalIdValid).toBe(false);
      expect(result.firstName).toBeNull();
      expect(result.fullName).toBeNull();
      expect(result.bloodType).toBeNull();
    });

    it('should handle code fences in DL response', async () => {
      const wrappedResp = {
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(sampleDLResponse) + '\n```' }],
      };
      mockCreate.mockResolvedValue(wrappedResp);

      const result = await service.extractDrivingLicense(validBase64);
      expect(result.licenseNo).toBe('12345678');
      expect(result.firstName).toBe('สมชาย');
    });

    it('should reject non-data-URL input for DL', async () => {
      await expect(
        service.extractDrivingLicense('https://example.com/dl.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when no API key configured for DL', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrService,
          {
            provide: ConfigService,
            useValue: { get: jest.fn(() => undefined) },
          },
        ],
      }).compile();

      const noKeyService = module.get<OcrService>(OcrService);

      await expect(
        noKeyService.extractDrivingLicense('data:image/jpeg;base64,/9j/4A=='),
      ).rejects.toThrow('ไม่ได้ตั้งค่า API Key');
    });
  });
});
