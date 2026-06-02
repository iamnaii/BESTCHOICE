import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let terminal: vscode.Terminal | undefined;

function getRepoRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;

  for (const f of folders) {
    const p = f.uri.fsPath;
    if (
      fs.existsSync(path.join(p, 'turbo.json')) &&
      fs.existsSync(path.join(p, 'apps', 'api')) &&
      fs.existsSync(path.join(p, 'apps', 'web'))
    ) {
      return p;
    }
  }
  return folders[0].uri.fsPath;
}

function ensureBestchoiceRoot(): string | undefined {
  const root = getRepoRoot();
  if (!root) {
    vscode.window.showErrorMessage('BESTCHOICE: ไม่เจอ workspace folder');
    return undefined;
  }
  const looksLikeBestchoice =
    fs.existsSync(path.join(root, 'turbo.json')) &&
    fs.existsSync(path.join(root, 'apps', 'api'));
  if (!looksLikeBestchoice) {
    vscode.window.showWarningMessage(
      'BESTCHOICE: workspace นี้ไม่ใช่ BESTCHOICE monorepo (ไม่เจอ turbo.json + apps/api)'
    );
  }
  return root;
}

function getTerminal(name = 'BESTCHOICE'): vscode.Terminal {
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({ name });
  }
  return terminal;
}

function runInTerminal(cwd: string, command: string, name?: string): void {
  const t = getTerminal(name);
  t.show(true);
  t.sendText(`cd "${cwd}" && ${command}`);
}

function runInNewTerminal(cwd: string, command: string, name: string): vscode.Terminal {
  const t = vscode.window.createTerminal({ name, cwd });
  t.show(true);
  t.sendText(command);
  return t;
}

async function pickFile(dir: string, glob: string, placeHolder: string): Promise<string | undefined> {
  if (!fs.existsSync(dir)) {
    vscode.window.showWarningMessage(`ไม่พบโฟลเดอร์: ${dir}`);
    return undefined;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(glob))
    .sort();
  if (files.length === 0) {
    vscode.window.showInformationMessage(`ไม่พบไฟล์ ${glob} ใน ${dir}`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(files, { placeHolder });
  return picked ? path.join(dir, picked) : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const register = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  register('bestchoice.checkTypes', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(root, './tools/check-types.sh all', 'BC: check-types');
  });

  register('bestchoice.checkTypesApi', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(root, './tools/check-types.sh api', 'BC: check-types api');
  });

  register('bestchoice.checkTypesWeb', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(root, './tools/check-types.sh web', 'BC: check-types web');
  });

  register('bestchoice.generateModule', async () => {
    const root = ensureBestchoiceRoot();
    if (!root) return;
    const name = await vscode.window.showInputBox({
      prompt: 'ชื่อ module (kebab-case)',
      placeHolder: 'เช่น product-tag',
      validateInput: (v) =>
        /^[a-z][a-z0-9-]*$/.test(v) ? null : 'ใช้ kebab-case: a-z, 0-9, -',
    });
    if (!name) return;
    runInTerminal(root, `./tools/generate-module.sh ${name}`, 'BC: generate-module');
  });

  register('bestchoice.runTests', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(root, './tools/run-tests.sh', 'BC: run-tests');
  });

  register('bestchoice.runE2E', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(path.join(root, 'apps/web'), 'npx playwright test', 'BC: e2e');
  });

  register('bestchoice.dbReset', async () => {
    const root = ensureBestchoiceRoot();
    if (!root) return;
    const confirm = await vscode.window.showWarningMessage(
      'ยืนยันรีเซ็ต Dev Database? ข้อมูลทั้งหมดจะถูกลบ',
      { modal: true },
      'รีเซ็ต'
    );
    if (confirm === 'รีเซ็ต') runInTerminal(root, './tools/db-reset.sh', 'BC: db-reset');
  });

  register('bestchoice.startDev', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInNewTerminal(root, 'npm run dev', 'BC: dev (turbo)');
  });

  register('bestchoice.startApi', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInNewTerminal(path.join(root, 'apps/api'), 'npm run dev', 'BC: api');
  });

  register('bestchoice.startWeb', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInNewTerminal(path.join(root, 'apps/web'), 'npm run dev', 'BC: web');
  });

  register('bestchoice.preDeploy', () => {
    const root = ensureBestchoiceRoot();
    if (!root) return;
    runInTerminal(
      root,
      './tools/check-types.sh all && ./tools/run-tests.sh',
      'BC: pre-deploy'
    );
  });

  register('bestchoice.openWorkflow', async () => {
    const root = ensureBestchoiceRoot();
    if (!root) return;
    const file = await pickFile(
      path.join(root, 'workflows'),
      '.md',
      'เลือก workflow ที่จะเปิด'
    );
    if (file) {
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc);
    }
  });

  register('bestchoice.openRule', async () => {
    const root = ensureBestchoiceRoot();
    if (!root) return;
    const file = await pickFile(
      path.join(root, '.claude', 'rules'),
      '.md',
      'เลือก rule ที่จะเปิด'
    );
    if (file) {
      const doc = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(doc);
    }
  });

  register('bestchoice.fbPreflight', () => {
    const root = ensureBestchoiceRoot();
    if (root) runInTerminal(root, './tools/fb-app-review-preflight.sh', 'BC: fb-preflight');
  });

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  status.text = '$(rocket) BC';
  status.tooltip = 'BESTCHOICE Helper — open command palette → BESTCHOICE:';
  status.command = 'workbench.action.quickOpen';
  if (getRepoRoot() && fs.existsSync(path.join(getRepoRoot()!, 'turbo.json'))) {
    status.show();
  }
  context.subscriptions.push(status);
}

export function deactivate(): void {
  if (terminal) terminal.dispose();
}
