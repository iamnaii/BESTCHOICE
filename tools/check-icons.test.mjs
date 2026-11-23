import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { reviewIconUsage, scanIconUsage } from './check-icons.mjs';

const app = 'apps/web/src/fixture.tsx';
const shop = 'apps/web-shop/src/fixture.tsx';
const history = 'apps/web/public/design-preview-liff-history.html';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'check-icons-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

function exception(finding, reason = 'Selectable user message content.') {
  return { ...finding, reason, category: 'content' };
}

test('rejects legacy package aliases, re-exports, dynamic imports and require', async (t) => {
  const root = await fixture(t, {
    [app]: `
      import { AlertTriangle as LocalAlias } from 'lucide-react';
      export { Check as Shared } from 'lucide-react/dist/icons/check';
      export * from '@heroicons/react/24/outline';
      const load = () => import(\`react-icons/fa\`);
      const glyphs = require('lucide-react');
      import More = require('lucide-react');
      type Other = import('lucide-react').Icon;
    `,
  });
  const findings = await scanIconUsage(root);
  assert.equal(findings.length, 7);
  assert.ok(findings.every(({ kind }) => kind === 'legacy-import'));
  const review = reviewIconUsage(findings, [exception(findings[0])]);
  assert.equal(review.forbidden.length, 7);
  assert.equal(review.invalid.length, 1);
});

test('permits only central Phosphor paths and never accepts a Phosphor exception', async (t) => {
  const importGlyph = "import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';";
  const root = await fixture(t, {
    'packages/icons/src/index.ts': importGlyph,
    'packages/icons/src/create-icon.ts': "import type { Icon } from '@phosphor-icons/react';",
    'apps/web/src/config/navigation-icons.ts': importGlyph,
    'apps/web/src/config/neighbor.ts': importGlyph,
    [shop]: importGlyph,
  });
  const findings = await scanIconUsage(root);
  assert.deepEqual(
    findings.map(({ path, kind }) => [path, kind]),
    [
      [shop, 'direct-phosphor'],
      ['apps/web/src/config/neighbor.ts', 'direct-phosphor'],
    ],
  );
  assert.equal(
    reviewIconUsage(
      findings,
      findings.map((finding) => exception(finding)),
    ).forbidden.length,
    2,
  );
});

test('ignores comments, generated output and fixture markup', async (t) => {
  const root = await fixture(t, {
    [app]: `
      // import { Check } from 'lucide-react'; 🛑
      export const View = () => <div>{/* <svg/> ⚠ */}Company &amp; Co.</div>;
    `,
    'apps/web/src/fixture.test.tsx': 'const example = <span>⚠</span>;',
    'apps/web/src/dist/generated.tsx': 'const example = <span>⚠</span>;',
    'apps/web/src/node_modules/fixture/index.ts': "export * from 'lucide-react';",
    'apps/web-shop/dist/index.html': '<button>⚠</button>',
    'apps/web/public/test.html': '<!-- <img src="/bad.svg"> ⚠ --> <p>Company &amp; Co.</p>',
    'apps/web/public/test.css': '/* .warning::before { content: "⚠"; } */',
  });
  assert.deepEqual(await scanIconUsage(root), []);
});

test('finds JSX warnings, arrows, ASCII controls and decimal, hex and named entities', async (t) => {
  const root = await fixture(t, {
    [app]: `
      const AddLabel = "+";
      export const View = () => <>
        <div role="alert">!</div><button>{AddLabel}</button><button>+</button>
        <div>⚠ warning</div><span>✓</span><button>← Back</button><a>Next →</a>
        <span>&#10003;</span><span>&#x2713;</span><span>&check;</span>
        <span title="&#10003;">OK</span><span>Company &amp; Co.</span>
        <button>{"×"}</button><button>&gt;</button>
      </>;
    `,
  });
  const findings = await scanIconUsage(root);
  assert.equal(findings.length, 13);
  assert.ok(findings.every(({ kind }) => kind === 'unicode-symbol'));
  assert.equal(findings.filter(({ context }) => context.includes('Company')).length, 0);
  for (const glyph of ['⚠', '✓', '← Back', 'Next →', '&#10003;', '&#x2713;', '&check;', '&gt;']) {
    assert.ok(
      findings.some(({ context }) => context.includes(glyph)),
      glyph,
    );
  }
});

test('classifies arithmetic, keycaps and data by their exact syntax context', async (t) => {
  const root = await fixture(t, {
    [shop]: `
      const trendAxis = { up: "↑", down: "↓", point: "●" };
      export const Labels = () => <><span>Dr↔Cr</span><kbd>↑</kbd><kbd>+</kbd><span>กำไร (+)</span></>;
      export const Controls = () => <><button>↑</button><button>← Back</button></>;
      const sum = 1 + 2 - 3;
    `,
  });
  const findings = await scanIconUsage(root);
  assert.equal(findings.length, 9);
  const approved = findings.filter(({ context }) => !context.includes('Controls'));
  const review = reviewIconUsage(
    findings,
    approved.map((finding) => exception(finding)),
  );
  assert.equal(review.approved.length, 7);
  assert.deepEqual(
    review.unclassified,
    findings.filter(({ context }) => context.includes('Controls')),
  );
});

test('finds pagination, remove, tab and hierarchy glyphs in their controls', async (t) => {
  const root = await fixture(t, {
    [app]: `
      export const Controls = () => <>
        <Button onClick={previous}>...</Button>
        <button aria-label="Remove">&times;</button>
        <button aria-pressed={selected}>😊 Emoji</button>
        <SelectItem value="option">{indent ? \`↳ \${label}\` : label}</SelectItem>
      </>;
    `,
  });
  const findings = await scanIconUsage(root);
  assert.equal(findings.length, 4);
  for (const glyph of ['...', '&times;', '😊 Emoji', '↳']) {
    assert.ok(
      findings.some(({ context }) => context.includes(glyph)),
      glyph,
    );
  }
});

test('binds review to the containing array, property and markup and to a nonempty reason', async (t) => {
  const root = await fixture(t, {
    [shop]: `
      const emojiGroups = [{ title: "Faces", entries: ["😀"] }];
      const controls = [{ icon: "😀" }];
      export const Add = () => <button>😀</button>;
    `,
  });
  const findings = await scanIconUsage(root);
  const reviewed = findings.find(
    ({ context }) => context.includes('emojiGroups') && context.includes('entries'),
  );
  assert.ok(reviewed);
  const review = reviewIconUsage(findings, [exception(reviewed)]);
  assert.deepEqual(review.approved, [reviewed]);
  assert.equal(review.unclassified.length, 2);
  assert.equal(reviewIconUsage(findings, [exception(reviewed, '  ')]).invalid.length, 1);
});

test('finds inline drawings, embedded CSS, image glyphs and CSS progress', async (t) => {
  const root = await fixture(t, {
    [app]: `
      export const Chart = () => <svg viewBox="0 0 32 32"><path d="M2 2L6 6"/></svg>;
      export const View = () => <>
        <img alt="" src="/icons/create.svg"/>
        <span className="size-5 rounded-full border-2 border-t-transparent animate-spin" />
        <span className="size-5 rounded-full animate-spin" style={{ background: 'conic-gradient(red, blue)' }} />
        <span className="bg-[url('/icons/confirm.png')]" />
        <span style={{ maskImage: 'url(/icons/close.svg)' }} />
      </>;
    `,
    'apps/web-shop/src/icons.css': `
      .add::before { content: "\\2713"; }
      .icon { mask: url('/icons/add.svg'); }
      .wait { border: 2px solid; border-top-color: transparent; animation: spin 1s linear; }
      .logo { background-image: url('/brand.webp'); }
      .font { src: url('/font.woff2'); }
      .rule::after { content: ''; }
    `,
    'apps/web-shop/public/example.html': `
      <style>.button::before { content: "✓"; }</style>
      <button>&check;</button><button>&#x2713;</button><button>&#10003;</button>
      <p>Company &amp; Co.</p><svg><path d="M0 0"></path></svg>
      <img src="/icons/close.webp"><span style="mask-image: url(/icons/mask.svg)"></span>
    `,
  });
  const findings = await scanIconUsage(root);
  for (const [path, expected] of [
    [app, [...Array(5).fill('image-or-css-icon'), 'inline-svg']],
    ['apps/web-shop/src/icons.css', Array(4).fill('image-or-css-icon')],
    [
      'apps/web-shop/public/example.html',
      [
        'image-or-css-icon',
        'image-or-css-icon',
        'image-or-css-icon',
        'inline-svg',
        'unicode-symbol',
        'unicode-symbol',
        'unicode-symbol',
      ],
    ],
  ]) {
    assert.deepEqual(
      findings
        .filter((finding) => finding.path === path)
        .map(({ kind }) => kind)
        .sort(),
      expected,
    );
  }
  const chart = findings.find((finding) => finding.path === app && finding.kind === 'inline-svg');
  const review = reviewIconUsage(findings, [
    { ...chart, category: 'graphic', reason: 'Plots data.' },
  ]);
  assert.deepEqual(review.approved, [chart]);
});

test('rejects wildcard, duplicate and stale entries and rejects a repeated glyph in identical markup', async (t) => {
  const root = await fixture(t, {
    [app]: 'export const View = () => <><span>✓</span><span>✓</span></>;',
  });
  const findings = await scanIconUsage(root);
  assert.equal(findings.length, 2);
  const approved = exception(findings[0]);
  const review = reviewIconUsage(findings, [
    approved,
    approved,
    { ...approved, path: 'apps/web/src/**' },
    { ...approved, context: '✓' },
  ]);
  assert.deepEqual(review.approved, [findings[0]]);
  assert.deepEqual(review.unclassified, [findings[1]]);
  assert.equal(review.invalid.length, 2);
  assert.equal(review.stale.length, 1);
});

test('pins historical source to a digest and still rejects forbidden imports in it', async (t) => {
  const root = await fixture(t, { [history]: '<b>⚠</b><svg></svg>' });
  const [original] = await scanIconUsage(root);
  assert.match(original.context, /sha256:[a-f0-9]{64}$/);
  const approved = { ...original, category: 'reference', reason: 'Historical UI mockup.' };
  assert.deepEqual(reviewIconUsage([original], [approved]).unclassified, []);

  await writeFile(
    join(root, history),
    '<b>✓</b><script type="module">import "lucide-react";</script>',
  );
  const review = reviewIconUsage(await scanIconUsage(root), [approved]);
  assert.equal(review.stale.length, 1);
  assert.equal(review.unclassified.length, 1);
  assert.equal(review.forbidden.length, 1);
});

test('CLI reports failures and approves a reviewed fixture without editing it', async (t) => {
  const source = 'export const View = () => <kbd>↑</kbd>;';
  const manifest = 'tools/icon-exceptions.json';
  const root = await fixture(t, { [app]: source, [manifest]: '[]' });
  const cli = fileURLToPath(new URL('./check-icons.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
  const fail = run();
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /unclassified.*unicode-symbol/is);
  const [finding] = await scanIconUsage(root);
  await writeFile(
    join(root, manifest),
    JSON.stringify([exception(finding, 'Names the arrow key.')]),
  );
  const pass = run();
  assert.equal(pass.status, 0);
  assert.match(pass.stdout, /1 approved, 0 unclassified/);
  assert.equal(await readFile(join(root, app), 'utf8'), source);

  await writeFile(join(root, app), 'export const View = () => <kbd>Down</kbd>;');
  const stale = run();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale.*unicode-symbol/is);
});
