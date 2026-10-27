import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
export function inventory(root = process.cwd()) {
  const result = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { walk(file); continue; }
      if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const decorators = n => (ts.getDecorators(n) || []).map(d => d.expression.getText(source));
      for (const c of source.statements.filter(ts.isClassDeclaration)) {
        const cd = decorators(c);
        if (!cd.some(d => /^(Controller|WebSocketGateway)\(/.test(d))) continue;
        for (const m of c.members.filter(ts.isMethodDeclaration)) {
          const md = decorators(m);
          const transport = md.find(d => /^(Get|Post|Put|Patch|Delete|Head|Options|All|Sse|SubscribeMessage)\(/.test(d));
          const socketLifecycle = cd.some(d => d.startsWith('WebSocketGateway(')) && /^(handleConnection|handleDisconnect|emit|notify)/.test(m.name.getText(source));
          if (transport || socketLifecycle) result.push({ file: path.relative(root,file), controller:c.name.text, method:m.name.getText(source), classDecorators:cd, decorators:md, transport:transport || 'SocketLifecycleOrOutput' });
        }
      }
    }
  }
  walk(path.join(root, 'apps/api/src'));
  return result.sort((a,b) => `${a.controller}.${a.method}`.localeCompare(`${b.controller}.${b.method}`));
}
