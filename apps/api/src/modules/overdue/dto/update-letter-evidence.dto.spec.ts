import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  UpdateLetterEvidenceDto,
  isPrivateOrLoopbackHost,
} from './update-letter-evidence.dto';

async function expectInvalid(url: string) {
  const dto = plainToInstance(UpdateLetterEvidenceDto, { evidencePhotoUrl: url });
  const errors = await validate(dto);
  expect(errors.length).toBeGreaterThan(0);
}

async function expectValid(url: string) {
  const dto = plainToInstance(UpdateLetterEvidenceDto, { evidencePhotoUrl: url });
  const errors = await validate(dto);
  expect(errors).toHaveLength(0);
}

describe('UpdateLetterEvidenceDto — SSRF defenses', () => {
  const ORIGINAL_S3_ENDPOINT = process.env.S3_ENDPOINT;

  afterEach(() => {
    if (ORIGINAL_S3_ENDPOINT === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = ORIGINAL_S3_ENDPOINT;
  });

  describe('rejects internal / loopback / private hosts', () => {
    it('rejects loopback IPv4 (127.0.0.1)', async () => {
      await expectInvalid('https://127.0.0.1/x');
    });

    it('rejects cloud metadata IMDS (169.254.169.254)', async () => {
      await expectInvalid('https://169.254.169.254/x');
    });

    it('rejects RFC1918 10.x', async () => {
      await expectInvalid('https://10.0.0.1/x');
    });

    it('rejects RFC1918 192.168.x', async () => {
      await expectInvalid('https://192.168.1.1/x');
    });

    it('rejects RFC1918 172.16-31.x', async () => {
      await expectInvalid('https://172.20.0.5/x');
    });

    it('rejects 0.0.0.0', async () => {
      await expectInvalid('https://0.0.0.0/x');
    });

    it('rejects IPv6 loopback [::1]', async () => {
      await expectInvalid('https://[::1]/x');
    });

    it('rejects "localhost" hostname', async () => {
      await expectInvalid('https://localhost/x');
    });

    it('rejects subdomain of .localhost', async () => {
      await expectInvalid('https://api.localhost/x');
    });
  });

  describe('rejects non-https schemes', () => {
    it('rejects http://example.com (not https)', async () => {
      await expectInvalid('http://example.com/x');
    });

    it('rejects ftp scheme', async () => {
      await expectInvalid('ftp://storage.googleapis.com/bucket/x');
    });

    it('rejects javascript: scheme', async () => {
      await expectInvalid('javascript:alert(1)');
    });
  });

  describe('rejects unknown public hosts (allowlist enforcement)', () => {
    it('rejects evil.com even with valid https', async () => {
      delete process.env.S3_ENDPOINT;
      await expectInvalid('https://evil.com/x');
    });

    it('rejects look-alike host that contains storage.googleapis.com as path', async () => {
      delete process.env.S3_ENDPOINT;
      await expectInvalid('https://attacker.com/storage.googleapis.com/bucket/x');
    });

    it('rejects empty / malformed URLs', async () => {
      await expectInvalid('');
      await expectInvalid('not a url');
      await expectInvalid('https://');
    });
  });

  describe('accepts configured public storage hosts', () => {
    it('accepts GCS public URL (storage.googleapis.com)', async () => {
      delete process.env.S3_ENDPOINT;
      await expectValid('https://storage.googleapis.com/bestchoice-documents/letters/x.pdf');
    });

    it('accepts URL whose host matches S3_ENDPOINT', async () => {
      process.env.S3_ENDPOINT = 'https://minio.example.com';
      await expectValid('https://minio.example.com/bucket/x.jpg');
    });

    it('still accepts GCS even when S3_ENDPOINT is set', async () => {
      process.env.S3_ENDPOINT = 'https://minio.example.com';
      await expectValid('https://storage.googleapis.com/bucket/x.jpg');
    });

    it('rejects host that does not match S3_ENDPOINT', async () => {
      process.env.S3_ENDPOINT = 'https://minio.example.com';
      await expectInvalid('https://other.example.com/bucket/x.jpg');
    });
  });

  describe('isPrivateOrLoopbackHost — unit', () => {
    it.each([
      'localhost',
      '127.0.0.1',
      '10.255.255.255',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      'fe80::1',
    ])('flags %s as private', (h) => {
      expect(isPrivateOrLoopbackHost(h)).toBe(true);
    });

    it.each(['storage.googleapis.com', 'example.com', 'minio.example.com'])(
      'leaves %s alone (not private)',
      (h) => {
        expect(isPrivateOrLoopbackHost(h)).toBe(false);
      },
    );

    it('flags 172.15.x.x as private (any IPv4 literal rejected)', () => {
      // outside RFC1918 172.16-31 but still an IP literal — reject by default
      expect(isPrivateOrLoopbackHost('172.15.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('8.8.8.8')).toBe(true);
    });
  });
});
