import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { StorageService } from '../storage/storage.service';

describe('canned-response image upload', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  function make(backend = 's3', configured = true) {
    const storage = {
      configured,
      describe: () => ({ backend }),
      upload: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn((key: string) => `https://cdn.example.test/${key}`),
    };
    return { storage, service: new BroadcastService(storage as unknown as StorageService) };
  }
  it('stores byte-derived PNG metadata and returns the configured public URL', async () => {
    const { storage, service } = make();
    const result = await service.uploadImage(png);
    const key = storage.upload.mock.calls[0][0];
    expect(key).toMatch(/^broadcast\/images\/[a-f0-9-]+\.png$/);
    expect(storage.upload).toHaveBeenCalledWith(key, png, 'image/png');
    expect(result).toEqual({ url: `https://cdn.example.test/${key}` });
  });
  it('rejects unsupported bytes before storage', async () => {
    const { storage, service } = make();
    await expect(service.uploadImage(Buffer.from('invalid'))).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it.each([['local', true], ['s3', false]])('rejects unavailable public storage %s/%s', async (backend, configured) => {
    const { storage, service } = make(backend as string, configured as boolean);
    await expect(service.uploadImage(png)).rejects.toThrow(ServiceUnavailableException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
