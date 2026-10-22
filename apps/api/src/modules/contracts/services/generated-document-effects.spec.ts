import { DocumentRenderingService } from './document-rendering.service';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { GeneratedEffectBudget, inertGeneratedHtml } from './generated-document-effects';
import {
  parsePdf,
  isA4,
  foldThai,
  sizesOfText,
  pageContaining,
} from '../../../../e2e/documents/support/pdf';

it('bounds streams and disposes a provider acquisition arriving after its deadline', async () => {
  const budget = new GeneratedEffectBudget(10),
    stream = Readable.from([Buffer.alloc(10)]);
  await expect(
    budget.wait(
      () => new Promise<Readable>((resolve) => setTimeout(() => resolve(stream), 30)),
      (late) => {
        late.destroy();
      },
    ),
  ).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(stream.destroyed).toBe(true);
  await expect(
    new GeneratedEffectBudget().buffer(Readable.from([Buffer.alloc(20 * 1024 * 1024 + 1)])),
  ).rejects.toThrow();
});
it('sanitizes active HTML and external CSS without corrupting Thai text', () => {
  const safe = inertGeneratedHtml(
    '<p onclick="secret()">สัญญา</p><script>SECRET</script><iframe src="https://bad.invalid"></iframe><style>@import "https://bad.invalid";</style><img src="file:///private">',
  );
  expect(safe).toContain('สัญญา');
  expect(safe).not.toMatch(/SECRET|onclick|iframe|bad.invalid|file:/);
});
it('owned Chromium produces Thai A4 while JavaScript and network loads are disabled', async () => {
  if (!process.env.PUPPETEER_EXECUTABLE_PATH)
    throw new Error('Owned smoke requires explicit Chromium executable');
  const { CdpPage } = await import('puppeteer-core/lib/cjs/puppeteer/cdp/Page.js');
  const original = CdpPage.prototype.setContent;
  let observedDisabled = false;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end('PROBE');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No owned probe');
    const origin = `http://127.0.0.1:${address.port}`;
    const content = jest.spyOn(CdpPage.prototype, 'setContent').mockImplementation(async function (
      this: InstanceType<typeof CdpPage>,
      html,
      options,
    ) {
      observedDisabled = !this.isJavaScriptEnabled();
      return original.call(
        this,
        html.replace(
          '<body>',
          `<body><script>document.body.innerHTML='JAVASCRIPT_EXECUTED';fetch('${origin}/defense-script')</script><img src='${origin}/defense-image'>`,
        ),
        options,
      );
    });
    const rendering = new DocumentRenderingService(undefined!, undefined!, undefined!);
    const wrapped = rendering.wrapWithA4Styles(
      `<style>@import '${origin}/css';</style><p>สัญญาเช่าซื้อ ทดสอบภาษาไทย 12345</p><script>document.body.innerHTML='JAVASCRIPT_EXECUTED';fetch('${origin}/script')</script><img src='${origin}/image'><iframe src='${origin}/frame'></iframe><!-- PAGE_BREAK --><p>หน้าที่สอง หลักฐานการแบ่งหน้า</p>`,
      null,
      'OWNED-THAI',
    );
    const bytes = await rendering.htmlToPdf(wrapped, 'OWNED-THAI', new GeneratedEffectBudget());
    content.mockRestore();
    expect(observedDisabled).toBe(true);
    const parsed = await parsePdf(bytes),
      text = parsed.pages.map((p) => p.text).join(' ');
    expect(parsed.pageCount).toBe(2);
    expect(sizesOfText(parsed, '12345')).toEqual([16]);
    expect(pageContaining(parsed, 'หน้าที่สอง หลักฐานการแบ่งหน้า')).toBe(2);
    expect(parsed.pages.every(isA4)).toBe(true);
    expect(foldThai(text)).toContain(foldThai('สัญญาเช่าซื้อ ทดสอบภาษาไทย'));
    expect(text).not.toContain('JAVASCRIPT_EXECUTED');
    expect(parsed.fonts.some((f) => f.includes('Sarabun'))).toBe(true);
    expect(requests).toBe(0);
    console.log(
      'OWNED_GENERATED_CHROMIUM',
      JSON.stringify({
        executable: process.env.PUPPETEER_EXECUTABLE_PATH,
        javascriptDisabled: observedDisabled,
        probe: origin,
        externalRequests: requests,
        bytes: bytes.length,
        pages: parsed.pages.map((p) => ({ width: p.widthPt, height: p.heightPt })),
        fonts: parsed.fonts,
        thai: true,
        bodySizePt: sizesOfText(parsed, '12345'),
        explicitSecondPage: pageContaining(parsed, 'หน้าที่สอง หลักฐานการแบ่งหน้า'),
      }),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 60000);

it('preserves canonical typography and page rules while removing embedded font URLs for controlled reinsertion', () => {
  const rendering = new DocumentRenderingService(undefined!, undefined!, undefined!);
  const safe = inertGeneratedHtml(
    rendering.wrapWithA4Styles('<p>ไทย</p><!-- PAGE_BREAK --><p>สอง</p>', null, 'OWNED'),
  );
  expect(safe).toContain('font-size: 16pt');
  expect(safe).toContain('page-break-after: always');
  expect(safe).toContain('table-header-group');
  expect(safe).not.toContain('url(data:font/ttf');
});

it('preview HTML carries fixed CSP and strips CSS resource functions without url tokens', () => {
  const safe = inertGeneratedHtml(
    '<style>p{background-image:image-set("https://probe.invalid/css" 1x)}</style><p style="background:image(&quot;https://probe.invalid/inline&quot;)">ไทย</p>',
  );
  expect(safe).not.toContain('probe.invalid');
  expect(safe).toContain('http-equiv="Content-Security-Policy"');
  expect(safe).toContain("default-src 'none'");
});
