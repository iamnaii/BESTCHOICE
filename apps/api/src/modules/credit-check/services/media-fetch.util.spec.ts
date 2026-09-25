import { BadRequestException } from '@nestjs/common';
import { detectFile, readLimited, fetchProviderMedia } from './media-fetch.util';
import { Readable } from 'stream';

describe('media-fetch.util', () => {
  it('detectFile sniffs jpeg/png/pdf and rejects unknown bytes', () => {
    expect(detectFile(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' });
    expect(detectFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toEqual({ mimeType: 'image/png', ext: 'png' });
    expect(() => detectFile(Buffer.from('hello'))).toThrow(BadRequestException);
    expect(() => detectFile(Buffer.alloc(0))).toThrow(BadRequestException);
  });
  it('readLimited stops at 10MB', async () => {
    const big = Readable.from([Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(readLimited(big)).rejects.toThrow('ไฟล์มีขนาดเกิน 10MB');
  });
  it('fetchProviderMedia refuses hosts outside the provider allowlist without calling fetch', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(fetchProviderMedia('https://evil.example.com/x.jpg')).rejects.toThrow('ไม่สามารถนำเข้าไฟล์จากแหล่งนี้ได้');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('fetchProviderMedia maps a 403 from fbcdn to the expired message', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 403, ok: false, headers: new Headers(), body: { cancel: async () => undefined } } as any);
    await expect(fetchProviderMedia('https://scontent.xx.fbcdn.net/a.jpg')).rejects.toThrow('ไฟล์หมดอายุ');
    spy.mockRestore();
  });
});
