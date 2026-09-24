import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { validateFileBase64 } from '../../ocr/services/ocr-parsing.util';

export const MAX_BYTES = 10 * 1024 * 1024;
export const EXPIRED_MEDIA_MSG =
  'ไฟล์หมดอายุหรือดาวน์โหลดจากแชทไม่ได้ กรุณาขอให้ลูกค้าส่งไฟล์ใหม่ หรือเลือกไฟล์จากเครื่อง';

export function detectFile(bytes: Buffer, _contentType?: string) {
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new BadRequestException('ไฟล์ต้องมีข้อมูลและขนาดไม่เกิน 10MB');
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    validateFileBase64(`data:application/pdf;base64,${bytes.toString('base64')}`);
    return { mimeType: 'application/pdf', ext: 'pdf' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mimeType: 'image/png', ext: 'png' };
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')))
    return { mimeType: 'image/gif', ext: 'gif' };
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mimeType: 'image/webp', ext: 'webp' };
  throw new BadRequestException(
    'รองรับ PDF, JPEG, PNG, GIF และ WebP เท่านั้น หากเป็น HEIC กรุณาแปลงเป็น JPEG ก่อน',
  );
}

/** Only provider media hosts stored by our message adapters; validate every redirect too. */
export function providerMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(EXPIRED_MEDIA_MSG);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !['fbcdn.net', 'fbsbx.com', 'line-scdn.net'].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new BadRequestException('ไม่สามารถนำเข้าไฟล์จากแหล่งนี้ได้ กรุณาเลือกไฟล์จากเครื่อง');
  }
  return url;
}

export async function readLimited(stream: AsyncIterable<Uint8Array | string>, limit = MAX_BYTES) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** ดาวน์โหลดไฟล์จาก CDN ของผู้ให้บริการแชท (fbcdn/fbsbx/line-scdn) ตาม redirect ≤ 3 ครั้ง — ตรรกะเดิมของ RoomCreditService.fetchMedia */
export async function fetchProviderMedia(raw: string): Promise<{ bytes: Buffer; contentType: string }> {
  let url = providerMediaUrl(raw);
  try {
    const signal = AbortSignal.timeout(20000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        url = providerMediaUrl(new URL(response.headers.get('location') || '', url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new BadRequestException(EXPIRED_MEDIA_MSG);
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel();
        throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB');
      }
      if (!response.body) throw new BadRequestException(EXPIRED_MEDIA_MSG);
      const bytes = await readLimited(Readable.fromWeb(response.body as never));
      return { bytes, contentType: response.headers.get('content-type') || '' };
    }
    throw new BadRequestException(EXPIRED_MEDIA_MSG);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(EXPIRED_MEDIA_MSG);
  }
}
