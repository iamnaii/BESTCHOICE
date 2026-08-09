import { buildSharePage, buildShareDescription, escapeHtml } from './share-page.util';

const base = {
  title: 'iPhone 15 Pro 256GB Blue',
  description: 'มือสอง เกรด A · ฿29,900',
  brand: 'Apple',
  condition: 'USED' as const,
  price: 29900,
  imageUrl: 'https://cdn.example.com/a.jpg',
  inStock: true,
  canonicalUrl: 'https://www.bestchoicephone.com/products/p-1',
  nonce: 'NONCE123',
};

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" data-y='z'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('buildSharePage — XSS hardening', () => {
  it('never emits a raw <script> that came from product data', () => {
    const html = buildSharePage({ ...base, title: '<script>alert(1)</script>iPhone' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double quotes so an attribute cannot be broken out of', () => {
    const html = buildSharePage({ ...base, title: 'iPhone" onload="alert(1)' });
    expect(html).not.toContain('" onload="alert(1)');
    expect(html).toContain('&quot; onload=&quot;alert(1)');
  });

  it('escapes < inside the JSON-LD block so </script> cannot break out', () => {
    const html = buildSharePage({ ...base, description: 'x </script><img src=1 onerror=alert(1)>' });
    const ld = html.slice(html.indexOf('application/ld+json'));
    expect(ld).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script');
  });
});

describe('buildSharePage — Open Graph', () => {
  it('emits og:image from the gallery image', () => {
    expect(buildSharePage(base)).toContain(
      '<meta property="og:image" content="https://cdn.example.com/a.jpg">',
    );
  });
  it('omits og:image entirely when there is no image', () => {
    const html = buildSharePage({ ...base, imageUrl: undefined });
    expect(html).not.toContain('og:image');
  });
  it('emits og:title / og:url / canonical pointing at the SPA product page', () => {
    const html = buildSharePage(base);
    expect(html).toContain('<meta property="og:title" content="iPhone 15 Pro 256GB Blue">');
    expect(html).toContain(
      '<meta property="og:url" content="https://www.bestchoicephone.com/products/p-1">',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://www.bestchoicephone.com/products/p-1">',
    );
  });
  it('emits the price meta pair when a price exists and skips it when null', () => {
    expect(buildSharePage(base)).toContain('<meta property="product:price:amount" content="29900">');
    expect(buildSharePage({ ...base, price: null })).not.toContain('product:price:amount');
  });
});

describe('buildSharePage — redirect', () => {
  it('emits both a meta refresh and a JS replace to the canonical URL', () => {
    const html = buildSharePage(base);
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0;url=https://www.bestchoicephone.com/products/p-1">',
    );
    expect(html).toContain('window.location.replace("https://www.bestchoicephone.com/products/p-1")');
  });
  it('keeps a plain <a> fallback for crawlers/no-JS', () => {
    expect(buildSharePage(base)).toContain('href="https://www.bestchoicephone.com/products/p-1"');
  });
  it('stamps the CSP nonce on every script tag', () => {
    const html = buildSharePage(base);
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBe(2);
    expect(scripts.every((s) => s.includes('nonce="NONCE123"'))).toBe(true);
  });
});

describe('buildSharePage — JSON-LD', () => {
  it('emits Product + Offer with THB price and availability', () => {
    const html = buildSharePage(base);
    const start = html.indexOf('{', html.indexOf('application/ld+json'));
    const json = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    expect(json['@type']).toBe('Product');
    expect(json.offers.priceCurrency).toBe('THB');
    expect(json.offers.price).toBe('29900');
    expect(json.offers.availability).toBe('https://schema.org/InStock');
    expect(json.itemCondition).toBe('https://schema.org/UsedCondition');
  });
  it('drops offers entirely when there is no price', () => {
    const html = buildSharePage({ ...base, price: null });
    const start = html.indexOf('{', html.indexOf('application/ld+json'));
    const json = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    expect(json.offers).toBeUndefined();
  });
});

describe('buildShareDescription', () => {
  it('composes grade + battery + warranty + price for a used phone', () => {
    expect(
      buildShareDescription({
        title: 'iPhone 15 Pro 256GB',
        condition: 'USED',
        conditionGrade: 'A',
        batteryHealth: 92,
        shopWarrantyDays: 45,
        price: 29900,
      }),
    ).toBe(
      'iPhone 15 Pro 256GB · มือสอง เกรด A · แบต 92% · ประกันร้าน 45 วัน · ฿29,900 — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });
  it('says สอบถามราคา when there is no price and skips missing facts', () => {
    expect(buildShareDescription({ title: 'iPhone 16 128GB', condition: 'NEW', price: null })).toBe(
      'iPhone 16 128GB · เครื่องใหม่ มือ 1 · สอบถามราคา — ผ่อนได้บัตรประชาชนใบเดียว ร้าน BESTCHOICE ลพบุรี',
    );
  });
});
