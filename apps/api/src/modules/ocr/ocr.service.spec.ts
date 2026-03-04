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

  // Sample OCR response matching the ID card: น.ส. วันนี แววศรี
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

  describe('extractIdCard', () => {
    const validBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

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
        birthDate: '2521-10-30', // BE year not converted
        issueDate: '2024-13-29', // invalid month
        expiryDate: '2033-02-30', // Feb 30 does not exist
      };
      mockCreate.mockResolvedValue(makeMockResponse(responseWithBadDates));

      const result = await service.extractIdCard(validBase64);

      // 2521-10-30 is a valid date format (just wrong year) — it will pass isValidDate
      expect(result.issueDate).toBeNull(); // month 13 invalid
      expect(result.expiryDate).toBeNull(); // Feb 30 invalid
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
      // 3430600120504 checksum verification:
      // digits: 3,4,3,0,6,0,0,1,2,0,5,0,4
      // sum = 3*13 + 4*12 + 3*11 + 0*10 + 6*9 + 0*8 + 0*7 + 1*6 + 2*5 + 0*4 + 5*3 + 0*2
      //     = 39 + 48 + 33 + 0 + 54 + 0 + 0 + 6 + 10 + 0 + 15 + 0 = 205
      // check = (11 - 205%11) % 10 = (11 - 7) % 10 = 4 ✓
      const response = { ...sampleOcrResponse, nationalId: '3430600120504' };
      mockCreate.mockResolvedValue(makeMockResponse(response));

      const result = await service.extractIdCard(
        'data:image/jpeg;base64,/9j/4A==',
      );
      expect(result.nationalId).toBe('3430600120504');
    });
  });

  // Test with Bangkok-style ID card (แขวง/เขต address format)
  describe('extractIdCard — Bangkok address card', () => {
    const validBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

    // Simulated OCR response from a Bangkok-area ID card
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
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(bangkokCardResponse) }],
      });

      const result = await service.extractIdCard(validBase64);

      expect(result.nationalId).toBe('1100703971635');
      expect(result.nationalIdValid).toBe(true);
      expect(result.prefix).toBe('นาย');
      expect(result.firstName).toBe('ชิณวัตร');
      expect(result.lastName).toBe('ลีนิวัตร');
      expect(result.fullName).toBe('ชิณวัตร ลีนิวัตร');
      expect(result.birthDate).toBe('1999-07-15');
      expect(result.issueDate).toBe('2022-04-22');
      expect(result.expiryDate).toBe('2029-07-14');
      expect(result.confidence).toBe(0.88);
    });

    it('should parse Bangkok structured address (แขวง/เขต) correctly', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(bangkokCardResponse) }],
      });

      const result = await service.extractIdCard(validBase64);

      expect(result.addressStructured).not.toBeNull();
      expect(result.addressStructured!.houseNo).toBe('153');
      expect(result.addressStructured!.moo).toBe('');
      expect(result.addressStructured!.soi).toBe('เพชรบุรี 5');
      expect(result.addressStructured!.road).toBe('เพชรบุรี');
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
      expect(result.addressStructured!.district).toBe('ราชเทวี');
    });
  });
});
