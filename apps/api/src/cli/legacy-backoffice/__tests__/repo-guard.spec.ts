import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOutsideRepo, findRepoRoots, isInsideRepo } from '../repo-guard';

/** กัน `--out` ลงในโฟลเดอร์ของ repo (repo เป็นสาธารณะ — ไฟล์ผลลัพธ์มีข้อมูลลูกค้าจริง) */

describe('isInsideRepo', () => {
  it.each<[string, string, boolean]>([
    ['/work/repo', '/work/repo', true],
    ['/work/repo/out', '/work/repo', true],
    ['/work/repo/a/../out', '/work/repo', true],
    ['/work/repo/..data', '/work/repo', true], // ชื่อโฟลเดอร์ขึ้นต้นด้วย ".." ยังอยู่ใน repo
    ['/work/repo/', '/work/repo', true],
    ['/work/repo-export', '/work/repo', false],
    ['/work/out', '/work/repo', false],
    ['/work/repo/../out', '/work/repo', false],
    ['/', '/work/repo', false],
  ])('%s inside %s → %s', (outPath, repoRoot, expected) => {
    expect(isInsideRepo(outPath, repoRoot)).toBe(expected);
  });
});

describe('findRepoRoots / assertOutsideRepo', () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'repo-guard-'));
    // base/main (.git โฟลเดอร์) ⊃ base/main/wt (.git ไฟล์ของ worktree) ⊃ base/main/wt/src
    mkdirSync(join(base, 'main', '.git'), { recursive: true });
    mkdirSync(join(base, 'main', 'wt', 'src'), { recursive: true });
    writeFileSync(join(base, 'main', 'wt', '.git'), 'gitdir: ../.git/worktrees/wt\n');
    mkdirSync(join(base, 'export'));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('finds every enclosing checkout — the worktree (.git file) and the main repo (.git dir)', () => {
    expect(findRepoRoots(join(base, 'main', 'wt', 'src'))).toEqual([
      join(base, 'main', 'wt'),
      join(base, 'main'),
    ]);
    expect(findRepoRoots(join(base, 'export'))).toEqual([]);
  });

  it('refuses a folder inside the worktree or the main repo, even one not created yet', () => {
    const from = join(base, 'main', 'wt', 'src');
    for (const out of [
      join(base, 'main', 'wt', 'tmp', 'out'),
      join(base, 'main', 'out'),
      join(base, 'main'),
    ]) {
      expect(() => assertOutsideRepo(out, from)).toThrow(/ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/);
    }
    expect(() => assertOutsideRepo(join(base, 'export', 'out'), from)).not.toThrow();
  });

  it('follows a symlink that points into the repo', () => {
    symlinkSync(join(base, 'main', 'wt'), join(base, 'export', 'link'));
    expect(() =>
      assertOutsideRepo(join(base, 'export', 'link', 'out'), join(base, 'main', 'wt', 'src')),
    ).toThrow(/ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/);
  });
});
