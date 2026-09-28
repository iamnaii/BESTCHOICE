import { ConfigService } from '@nestjs/config';
import { BroadcastService } from './broadcast.service';
import { StorageService } from '../storage/storage.service';

/**
 * ระบบ Broadcast ถูกถอด 2026-09-28 เหลือเฉพาะตัวอัปโหลดรูปที่ตัวแก้ข้อความสำเร็จรูปใช้
 * เทสต์นี้ปักพฤติกรรมเดิมของ uploadImage ไว้: key ที่เก็บ และ URL สาธารณะทั้ง 3 แบบ
 */
describe('BroadcastService.uploadImage', () => {
  const NOW = 1_790_000_000_000;
  let upload: jest.Mock;

  function make(env: Record<string, string | undefined>) {
    upload = jest.fn().mockResolvedValue(undefined);
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    const storage = { upload } as unknown as StorageService;
    return new BroadcastService(config, storage);
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('เก็บไฟล์ใต้ broadcast/images/<เวลา>-<ชื่อไฟล์>', async () => {
    const service = make({ GCS_BUCKET: 'bucket-a' });
    const file = Buffer.from('x');

    await service.uploadImage(file, 'promo.png');

    expect(upload).toHaveBeenCalledWith(`broadcast/images/${NOW}-promo.png`, file, 'image/jpeg');
  });

  it('มี S3_ENDPOINT → URL ชี้ S3 (bucket เริ่มต้น bestchoice-documents)', async () => {
    const service = make({ S3_ENDPOINT: 'https://s3.example.test', GCS_BUCKET: 'bucket-a' });

    await expect(service.uploadImage(Buffer.from('x'), 'a.jpg')).resolves.toEqual({
      url: `https://s3.example.test/bestchoice-documents/broadcast/images/${NOW}-a.jpg`,
    });
  });

  it('ไม่มี S3 แต่มี GCS_BUCKET → URL ชี้ Google Cloud Storage', async () => {
    const service = make({ GCS_BUCKET: 'bucket-a' });

    await expect(service.uploadImage(Buffer.from('x'), 'a.jpg')).resolves.toEqual({
      url: `https://storage.googleapis.com/bucket-a/broadcast/images/${NOW}-a.jpg`,
    });
  });

  it('ไม่มีทั้งคู่ → เสิร์ฟผ่าน API โดย encode key', async () => {
    const service = make({ APP_URL: 'https://app.example.test' });

    await expect(service.uploadImage(Buffer.from('x'), 'a.jpg')).resolves.toEqual({
      url: `https://app.example.test/api/files/${encodeURIComponent(`broadcast/images/${NOW}-a.jpg`)}`,
    });
  });
});
