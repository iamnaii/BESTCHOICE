// node --test tools/shop-refresh/sitemap-products.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropProblem, liveMismatch, productUrls } from './sitemap-products.mjs';

const P = (id) => `https://www.bestchoicephone.com/products/${id}`;
const sitemap = (locs, eol = '\n') =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((loc) => `  <url>${eol}    <loc>${loc}</loc>${eol}  </url>`),
    '</urlset>',
  ].join(eol);

test('productUrls: นับเฉพาะหน้าเครื่อง /products/<id> ไม่นับหน้ารวม /products', () => {
  const xml = sitemap([
    'https://www.bestchoicephone.com/',
    'https://www.bestchoicephone.com/products',
    P('a1'),
    P('b2'),
  ]);
  assert.deepEqual(productUrls(xml), [P('a1'), P('b2')]);
});

test('productUrls: ไฟล์บรรทัด CRLF + URL ซ้ำ นับครั้งเดียว', () => {
  assert.deepEqual(productUrls(sitemap([P('a1'), P('a1'), P('b2')], '\r\n')), [P('a1'), P('b2')]);
});

test('productUrls: ไม่ใช่ sitemap (เช่นหน้า error) ⇒ throw ไม่ใช่นับเป็นศูนย์', () => {
  assert.throws(() => productUrls('<html>Service Unavailable</html>'), /sitemap/);
});

test('dropProblem: เหลือครึ่งพอดีผ่าน · ต่ำกว่าครึ่งไม่ผ่าน', () => {
  const live = Array.from({ length: 30 }, (_, i) => P(i));
  assert.equal(dropProblem(live.slice(0, 15), live), null);
  assert.match(dropProblem(live.slice(0, 14), live), /14.*30/);
});

test('dropProblem: build ได้ศูนย์ขณะเว็บมีสินค้า ⇒ ไม่ผ่าน', () => {
  assert.match(dropProblem([], [P('a1')]), /0.*1/);
});

test('dropProblem: เว็บยังไม่มีสินค้าเลย หรือ build ได้มากกว่า ⇒ ผ่าน', () => {
  assert.equal(dropProblem([], []), null);
  assert.equal(dropProblem([P('a1'), P('b2')], [P('a1')]), null);
});

test('liveMismatch: ชุดเดียวกันต่างลำดับ ⇒ ผ่าน · ต่างกัน ⇒ บอกจำนวนสองฝั่ง', () => {
  assert.equal(liveMismatch([P('a1'), P('b2')], [P('b2'), P('a1')]), null);
  assert.match(liveMismatch([P('a1'), P('b2')], [P('a1')]), /2.*1/);
  assert.match(liveMismatch([P('a1')], [P('b2')]), /1.*1/);
});
