/** Collect the public buyback benchmark. No customer/booking endpoints are used. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

function readObject(text, name) {
  const marker = `"${name}":`;
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`Missing public catalog ${name}`);
  const start = at + marker.length;
  let depth = 0, quoted = false, escaped = false;
  for (let end = start; end < text.length; end++) {
    const c = text[end];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quoted) { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, end + 1));
    }
  }
  throw new Error('Incomplete public catalog');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let publicApiKey;
    page.on('request', request => {
      if (request.url().startsWith('https://sure-api.applehouseth.com/v1/option/')) {
        publicApiKey = request.headers()['x-api-key'];
      }
    });
    await page.goto('https://applehouseth.com/', { waitUntil: 'networkidle', timeout: 60000 });
    const stream = await page.evaluate(() => window.__next_f.filter(x => x[0] === 1).map(x => x[1]).join(''));
    const phones = Object.values(readObject(stream, 'initialSpecs')).flat()
      .filter(p => /^iphone\b/i.test(p.phoneName.trim()));
    await page.goto('https://sure.applehouseth.com/', { waitUntil: 'networkidle', timeout: 60000 });
    if (!publicApiKey || !phones.length) throw new Error('Public estimator unavailable');
    const headers = { 'x-api-key': publicApiKey };
    // Validate option meanings on every refresh; never silently use changed codes.
    const conditions = {
      region: ['REGI-0001', 'เครื่องไทย'], battery: ['BAT-0007', '100'],
      accessory: ['ACC-0001', 'กล่อง'], warranty: ['WAR-0001', '4'],
      displayCondition: ['DIS-001', 'ไม่มีรอย'], frameCondition: ['FR-001', 'ไม่มีรอย'],
      backCoverCondition: ['RS-001', 'ไม่มีรอย'], backCameraCondition: ['BC-001', 'ไม่มีรอย'],
    };
    const basis = {};
    for (const [type, [key, text]] of Object.entries(conditions)) {
      const optionType = type === 'backCameraCondition' ? 'backCameraConditions' : type;
      const response = await page.request.get(`https://sure-api.applehouseth.com/v1/option/get-by-type?type=${optionType}`, { headers });
      const result = await response.json();
      const option = result.result?.typeOptions?.find(o => o.key === key);
      if (!response.ok() || !option?.label.includes(text)) throw new Error(`Option changed: ${type}`);
      basis[type] = option.label;
    }
    const rows = [], unavailable = [], seen = new Set();
    for (const phone of phones) {
      const model = phone.phoneName.replace(/\s+/g, ' ').trim().replace(/iPhone SE \(?(2020|2022)\)?/i, 'iPhone SE $1');
      const storage = phone.label.replace(/\s+/g, '').toUpperCase();
      if (!/^\d+(GB|TB)$/.test(storage)) throw new Error(`Unknown storage ${storage}`);
      const key = `${model}|${storage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const response = await page.request.post('https://sure-api.applehouseth.com/v1/estimation/estimation-price', {
        headers, data: {
          masterPhoneId: phone.key, product: phone.phoneName, usedCondition: [],
          ...Object.fromEntries(Object.entries(conditions).map(([type, [id]]) => [`${type}Id`, id])),
        },
      });
      const body = await response.json();
      if (!response.ok()) throw new Error(`Estimator HTTP ${response.status()} for ${key}`);
      const quote = body.result?.detailResult;
      const basePrice = Number(quote?.finalPrice);
      if (!body.success || !Number.isFinite(basePrice) || basePrice <= 0) {
        unavailable.push({ model, storage });
      } else {
        rows.push({ model, storage, basePrice, estimatePrice: Number(quote.estimateprice), promotion: Number(quote.promotion || 0) });
      }
      console.log(`${rows.length + unavailable.length}/${seen.size}: ${key}: ${basePrice || 'unavailable'}`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    if (!rows.length) throw new Error('No valid quotations; snapshot was not replaced');
    const destination = path.resolve(__dirname, '../apps/api/prisma/data/applehouse-valuations.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify({
      source: 'https://applehouseth.com/', estimator: 'https://sure.applehouseth.com/',
      fetchedAt: new Date().toISOString(), currency: 'THB', basis,
      priceField: 'finalPrice (includes promotion at collection time)', rows, unavailable,
    }, null, 2) + '\n');
    console.log(`Saved ${rows.length} prices, ${unavailable.length} unavailable to ${destination}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
