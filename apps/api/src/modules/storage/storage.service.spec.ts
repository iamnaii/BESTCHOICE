import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({ Body: 'mock-stream' });
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file.pdf'),
}));

describe('StorageService', () => {
  describe('when S3 is configured', () => {
    let service: StorageService;
    let mockSend: jest.Mock;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                  S3_ENDPOINT: 'http://localhost:9000',
                  S3_ACCESS_KEY: 'minioadmin',
                  S3_SECRET_KEY: 'minioadmin',
                  S3_BUCKET: 'test-bucket',
                  S3_REGION: 'ap-southeast-1',
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      service = module.get<StorageService>(StorageService);
      // Get the mock send function
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { __mockSend } = require('@aws-sdk/client-s3');
      mockSend = __mockSend;
      mockSend.mockClear();
    });

    it('should be configured', () => {
      expect(service.configured).toBe(true);
    });

    it('should upload file and return key', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await service.upload('test/file.pdf', Buffer.from('test'), 'application/pdf');
      expect(result).toBe('test/file.pdf');
      expect(mockSend).toHaveBeenCalled();
    });

    it('should get stream for download', async () => {
      mockSend.mockResolvedValueOnce({ Body: 'mock-readable-stream' });
      const result = await service.getStream('test/file.pdf');
      expect(result).toBe('mock-readable-stream');
    });

    it('should get signed download URL', async () => {
      const result = await service.getSignedDownloadUrl('test/file.pdf');
      expect(result).toBe('https://signed-url.example.com/file.pdf');
    });

    it('should delete file without error', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(service.delete('test/file.pdf')).resolves.not.toThrow();
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('when S3 is NOT configured', () => {
    let service: StorageService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<StorageService>(StorageService);
    });

    it('should not be configured', () => {
      expect(service.configured).toBe(false);
    });

    it('should return key as-is on upload without calling S3', async () => {
      const result = await service.upload('test/file.pdf', Buffer.from('test'), 'application/pdf');
      expect(result).toBe('test/file.pdf');
    });

    it('should throw error on getStream', async () => {
      await expect(service.getStream('test/file.pdf')).rejects.toThrow('S3 storage not configured');
    });

    it('should throw error on getSignedDownloadUrl', async () => {
      await expect(service.getSignedDownloadUrl('test/file.pdf')).rejects.toThrow('S3 storage not configured');
    });

    it('should not throw on delete (noop)', async () => {
      await expect(service.delete('test/file.pdf')).resolves.not.toThrow();
    });
  });
});
