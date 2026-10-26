import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ติดตั้งเป็นแอปบน iPhone/Android จากเบราว์เซอร์ (ก้อน 2 ของแผนปิดช่องว่าง Tooltify — A19 เลือก PWA แทนแอป native):
 * iOS ใช้เฉพาะ apple-touch-icon แบบ PNG (SVG ไม่ขึ้น) และ Android/Chrome ต้องมี PNG 192+512 พร้อม maskable
 * สีธีมต้องเป็นสีเขียวของแอป ไม่ใช่ม่วงจาก template เดิม
 */
const WEB_ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(WEB_ROOT, p), 'utf8');

/** อ่านขนาดจาก IHDR ของ PNG (byte 16–23) โดยไม่ต้องพึ่งไลบรารี */
function pngSize(p: string): { width: number; height: number } {
  const buf = readFileSync(resolve(WEB_ROOT, p));
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const BRAND_GREEN = '#0b7a55'; // = hsl(160 84% 26%) ค่า --primary ใน index.css

describe('PWA ติดตั้งลงหน้าจอ', () => {
  const manifest = JSON.parse(read('public/manifest.json')) as {
    name: string;
    short_name: string;
    theme_color: string;
    background_color: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('manifest มีไอคอน PNG 192 และ 512 ทั้งแบบ any และ maskable และไฟล์มีอยู่จริงขนาดตรง', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    const find = (sizes: string, purpose: string) =>
      png.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    for (const [sizes, purpose] of [
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]) {
      const icon = find(sizes, purpose);
      expect(icon, `${sizes} ${purpose}`).toBeDefined();
      const file = `public${icon!.src}`;
      expect(existsSync(resolve(WEB_ROOT, file)), file).toBe(true);
      const [w] = sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width: w, height: w });
    }
  });

  it('สีธีมและพื้นหลังเป็นสีของแอป ไม่ใช่ม่วง template เดิม และตรงกับ meta ใน index.html', () => {
    expect(manifest.theme_color.toLowerCase()).toBe(BRAND_GREEN);
    expect(manifest.background_color.toLowerCase()).toBe('#f9f8f6');
    const html = read('index.html');
    expect(html).toMatch(new RegExp(`<meta name="theme-color" content="${BRAND_GREEN}"`, 'i'));
    expect(html).not.toMatch(/4f46e5/i);
  });

  it('manifest เปิดแบบ standalone ที่หน้าแรก และชื่อสั้นพอขึ้นใต้ไอคอน', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('iPhone: apple-touch-icon เป็น PNG 180px และมี meta ให้ Safari เปิดเต็มจอ', () => {
    const html = read('index.html');
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="BESTCHOICE"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="default"/);
  });
});
