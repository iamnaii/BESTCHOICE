import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { parse, serialize, DefaultTreeAdapterMap } from 'parse5';
import { matchesDocumentMime } from './document-mime.util';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';
export const GENERATED_PDF_LIMIT = 20 * 1024 * 1024;
export class GeneratedEffectBudget {
  readonly controller = new AbortController();
  readonly expiresAt: number;
  constructor(milliseconds = 45000) {
    this.expiresAt = Date.now() + milliseconds;
  }
  check() {
    if (this.controller.signal.aborted || Date.now() >= this.expiresAt) {
      this.controller.abort();
      throw new ServiceUnavailableException('การสร้างเอกสารหมดเวลา');
    }
  }
  async wait<T>(work: () => Promise<T>, late?: (value: T) => void | Promise<void>): Promise<T> {
    this.check();
    let timer: ReturnType<typeof setTimeout> | undefined,
      expired = false;
    const pending = work().then(async (value) => {
      if (expired || this.controller.signal.aborted || Date.now() >= this.expiresAt) {
        await late?.(value);
        throw new ServiceUnavailableException('การสร้างเอกสารหมดเวลา');
      }
      return value;
    });
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              expired = true;
              this.controller.abort();
              reject(new ServiceUnavailableException('การสร้างเอกสารหมดเวลา'));
            },
            Math.max(1, this.expiresAt - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async buffer(stream: Readable): Promise<Buffer> {
    const abort = () => stream.destroy(new ServiceUnavailableException('การอ่านเอกสารหมดเวลา'));
    this.controller.signal.addEventListener('abort', abort, { once: true });
    try {
      return await this.wait(async () => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          this.check();
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > GENERATED_PDF_LIMIT) throw new BadRequestException('ไฟล์เอกสารใหญ่เกินไป');
          chunks.push(bytes);
        }
        return Buffer.concat(chunks, size);
      });
    } finally {
      this.controller.signal.removeEventListener('abort', abort);
      stream.destroy();
    }
  }
}
export function safeEmbeddedImage(value: string): boolean {
  if (value.length > 15000000) return false;
  const parts = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!parts) return false;
  const bytes = Buffer.from(parts[2], 'base64');
  return (
    bytes.length > 0 &&
    bytes.length <= 10 * 1024 * 1024 &&
    bytes.toString('base64') === parts[2] &&
    matchesDocumentMime(bytes, parts[1])
  );
}
/** Parse HTML instead of regex-stripping active tags. Embedded font CSS is added
 * separately by the canonical wrapper, never accepted from untrusted HTML. */
export function inertGeneratedHtml(html: string): string {
  if (Buffer.byteLength(html) > 32 * 1024 * 1024) throw new BadRequestException('เอกสารใหญ่เกินไป');
  // Strip only our byte-identical local font declaration before CSS screening.
  // The caller reinserts these server fonts after sanitization; canonical page
  // and typography rules sharing their style block must survive.
  const tree = parse(html.split(embeddedDocumentFonts()).join('')),
    allowed = new Set([
      'html',
      'head',
      'body',
      'meta',
      'style',
      'div',
      'span',
      'p',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'b',
      'i',
      'em',
      'u',
      's',
      'small',
      'sup',
      'sub',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'ul',
      'ol',
      'li',
      'section',
      'article',
      'header',
      'footer',
      'img',
      'blockquote',
    ]);
  const cleanCss = (css: string) =>
    /(?:url|image-set|image|src)\s*\(|@import|expression\s*\(|\\|<|>/i.test(css) ? '' : css;
  const visit = (node: DefaultTreeAdapterMap['parentNode']) => {
    node.childNodes = node.childNodes.filter(
      (child) => !('tagName' in child) || allowed.has(child.tagName),
    );
    for (const child of node.childNodes)
      if ('tagName' in child) {
        child.attrs = child.attrs
          .filter(
            (a) =>
              [
                'class',
                'style',
                'colspan',
                'rowspan',
                'width',
                'height',
                'align',
                'lang',
                'charset',
                'src',
                'alt',
              ].includes(a.name) && !a.namespace,
          )
          .map((a) => ({ ...a, value: a.name === 'style' ? cleanCss(a.value) : a.value }));
        if (child.tagName === 'img')
          child.attrs = child.attrs.filter((a) => a.name !== 'src' || safeEmbeddedImage(a.value));
        else child.attrs = child.attrs.filter((a) => a.name !== 'src');
        if (child.tagName === 'style')
          for (const content of child.childNodes)
            if (content.nodeName === '#text' && 'value' in content)
              content.value = cleanCss(content.value);
        visit(child);
      }
  };
  visit(tree);
  const safe = serialize(tree).replace(
    '</head>',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"> </head>`,
  );
  if (Buffer.byteLength(safe) > 32 * 1024 * 1024) throw new BadRequestException('เอกสารใหญ่เกินไป');
  return safe;
}
export async function renderOwnedGeneratedPdf(
  html: string,
  contractNumber: string | undefined,
  budget: GeneratedEffectBudget,
): Promise<Buffer> {
  const puppeteer = await import('puppeteer-core');
  const browser = await budget.wait(
    () =>
      puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        timeout: Math.max(1, budget.expiresAt - Date.now()),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-background-networking',
        ],
      }),
    async (late) => {
      await close(late);
    },
  );
  const kill = () => browser.process()?.kill('SIGKILL');
  budget.controller.signal.addEventListener('abort', kill, { once: true });
  try {
    const page = await budget.wait(() => browser.newPage());
    await budget.wait(() => page.setJavaScriptEnabled(false));
    await budget.wait(() => page.setRequestInterception(true));
    const fontCss = embeddedDocumentFonts();
    const fonts = new Set([...fontCss.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map((m) => m[1]));
    page.on('request', (req) => {
      const target = req.url();
      void (
        target.startsWith('data:') && (fonts.has(target) || safeEmbeddedImage(target))
          ? req.continue()
          : req.abort()
      ).catch(() => undefined);
    });
    const safe = inertGeneratedHtml(html).replace(
      '</head>',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${fontCss}</style></head>`,
    );
    if (Buffer.byteLength(safe) > 32 * 1024 * 1024)
      throw new BadRequestException('เอกสารใหญ่เกินไป');
    await budget.wait(() =>
      page.setContent(safe, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1, budget.expiresAt - Date.now()),
      }),
    );
    await budget.wait(() => page.evaluate('document.fonts.ready'));
    await budget.wait(() =>
      page.addStyleTag({
        content: `${fontCss} body {font-family:'TH Sarabun PSK';background:#fff!important;padding:0!important;margin:0!important}.a4-page{box-shadow:none!important;margin:0!important;min-height:auto!important;padding:0!important;width:100%!important}.a4-page+.a4-page{page-break-before:always;break-before:page}`,
      }),
    );
    const label = (contractNumber ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
    const result = await budget.wait(() =>
      page.pdf({
        format: 'A4',
        printBackground: true,
        timeout: Math.max(1, budget.expiresAt - Date.now()),
        margin: { top: '20mm', right: '19mm', bottom: '20mm', left: '19mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<style>${fontCss}</style><div style="font-family:'TH Sarabun PSK';width:100%;padding:0 19mm;font-size:16px">สัญญาเช่าซื้อเลขที่ ${label} — หน้าที่ <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      }),
    );
    const bytes = Buffer.from(result);
    if (
      !bytes.length ||
      bytes.length > GENERATED_PDF_LIMIT ||
      !matchesDocumentMime(bytes, 'application/pdf')
    )
      throw new BadRequestException('ผลลัพธ์ PDF ไม่ถูกต้อง');
    return bytes;
  } finally {
    budget.controller.signal.removeEventListener('abort', kill);
    await close(browser);
  }
}
async function close(browser: import('puppeteer-core').Browser) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          browser.process()?.kill('SIGKILL');
          resolve();
        }, 1000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
