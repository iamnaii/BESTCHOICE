import { describe, expect, it } from 'vitest';
import { buildBreadcrumbJsonLd, buildProductJsonLd, jsonLdForScript } from './product-json-ld';

const BASE = 'https://www.bestchoicephone.com';

const input = {
  name: 'Apple iPhone 15 128GB ดำ',
  description: 'Apple iPhone 15 128GB ดำ ผ่อนได้บัตรประชาชนใบเดียว',
  brand: 'Apple',
  condition: 'USED' as const,
  images: [`${BASE}/api/shop/products/u1/photos/front?v=1`],
  url: `${BASE}/products/u1`,
  price: 18000,
  inStock: true,
};

describe('buildProductJsonLd', () => {
  it('โครงเดียวกับหน้าการ์ดแชร์: Product + Offer เป็นบาท ชี้ URL ของหน้าสินค้า', () => {
    expect(buildProductJsonLd(input)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Apple iPhone 15 128GB ดำ',
      description: 'Apple iPhone 15 128GB ดำ ผ่อนได้บัตรประชาชนใบเดียว',
      brand: { '@type': 'Brand', name: 'Apple' },
      itemCondition: 'https://schema.org/UsedCondition',
      image: [`${BASE}/api/shop/products/u1/photos/front?v=1`],
      offers: {
        '@type': 'Offer',
        url: `${BASE}/products/u1`,
        priceCurrency: 'THB',
        price: '18000',
        availability: 'https://schema.org/InStock',
      },
    });
  });

  it('เครื่องใหม่ = NewCondition · หมดสต็อก = OutOfStock', () => {
    const ld = buildProductJsonLd({ ...input, condition: 'NEW', inStock: false });
    expect(ld.itemCondition).toBe('https://schema.org/NewCondition');
    expect((ld.offers as { availability: string }).availability).toBe(
      'https://schema.org/OutOfStock',
    );
  });

  it.each([null, 0, -1])('ไม่มีราคา (%s) = ไม่ใส่ offers', (price) => {
    expect(buildProductJsonLd({ ...input, price })).not.toHaveProperty('offers');
  });

  it('ไม่มีรูป = ไม่ใส่ image · รูปที่เป็น path ถูกเติมโดเมนให้เป็น URL เต็ม', () => {
    expect(buildProductJsonLd({ ...input, images: [] })).not.toHaveProperty('image');
    expect(
      buildProductJsonLd({ ...input, images: ['/api/shop/products/u1/photos/back'] }).image,
    ).toEqual([`${BASE}/api/shop/products/u1/photos/back`]);
  });
});

describe('buildBreadcrumbJsonLd', () => {
  it('ลำดับตามแถบเส้นทางบนหน้า · รายการสุดท้าย (ไม่มีลิงก์) ชี้หน้าปัจจุบัน', () => {
    expect(
      buildBreadcrumbJsonLd(
        [
          { label: 'หน้าแรก', to: '/' },
          { label: 'สินค้าทั้งหมด', to: '/products' },
          { label: 'iPhone 15' },
        ],
        `${BASE}/products/u1`,
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'หน้าแรก', item: `${BASE}/` },
        { '@type': 'ListItem', position: 2, name: 'สินค้าทั้งหมด', item: `${BASE}/products` },
        { '@type': 'ListItem', position: 3, name: 'iPhone 15', item: `${BASE}/products/u1` },
      ],
    });
  });
});

describe('jsonLdForScript', () => {
  it('escape "<" กัน </script> ในชื่อสินค้าที่แอดมินพิมพ์เอง — parse กลับได้ค่าเดิม', () => {
    const value = { name: 'iPhone </script><script>alert(1)</script>' };
    const out = jsonLdForScript(value);
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual(value);
  });
});
