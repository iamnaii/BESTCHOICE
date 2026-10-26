const fs=require('node:fs'), path=require('node:path'), ts=require('typescript');
const {twMerge}=require('tailwind-merge');
const out='.tmp/dropdown-migration-20261017';
const inv=require('../../docs/reports/dropdown-inventory-2026-10-17/inventory.json');
const files=[...new Set(inv.rows.filter(r=>r.kind!=='SHARED_NATIVE_IMPLEMENTATION').map(r=>r.file))];
const cache=new Map();
function ast(file) { if(!cache.has(file)) {const s=fs.readFileSync(file,'utf8'); cache.set(file,ts.createSourceFile(file,s,99,true,ts.ScriptKind.TSX));} return cache.get(file); }
function resolve(from,spec) {const b=spec.startsWith('@/') ? from.split('/src/')[0]+'/src/'+spec.slice(2):path.resolve(path.dirname(from),spec);return [b,b+'.ts',b+'.tsx',b+'/index.ts'].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());}
function expr(n,file,depth=0){
 if(!n||depth>8)return '';
 const a=ast(file);
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
 if(ts.isJsxExpression(n))return expr(n.expression,file,depth+1);
 if(ts.isTemplateExpression(n))return n.head.text+n.templateSpans.map(x=>expr(x.expression,file,depth+1)+x.literal.text).join('');
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken)return expr(n.left,file,depth+1)+expr(n.right,file,depth+1);
 if(ts.isCallExpression(n)&&n.expression.getText(a)==='cn')return twMerge(n.arguments.map(x=>expr(x,file,depth+1)).join(' '));
 if(ts.isIdentifier(n)) {
  if(n.text==='className'||n.text==='wrapperClassName')return '';
  if(n.text==='formControlClass')return 'w-full min-w-0 h-11 min-h-11';
  let value;const walk=x=>{if(ts.isVariableDeclaration(x)&&x.name.getText(a)===n.text&&x.initializer&&x!==n.parent)value=x.initializer;ts.forEachChild(x,walk);};walk(a);if(value)return expr(value,file,depth+1);
  for(const s of a.statements)if(ts.isImportDeclaration(s)&&s.importClause?.namedBindings&&ts.isNamedImports(s.importClause.namedBindings)) for(const e of s.importClause.namedBindings.elements)if(e.name.text===n.text){const f=resolve(file,s.moduleSpecifier.text);if(f)return expr(ts.factory.createIdentifier(e.propertyName?.text||e.name.text),f,depth+1);}
 }
 throw Error('Unresolved class '+n.getText(a)+' in '+file);
}
const layout=t=>/(?:^|:)(?:w-|min-w-|max-w-|flex-(?:1|auto|none|initial)|grow(?:-|$)|shrink(?:-|$)|basis-|self-|col-(?:span|start|end)-|row-(?:span|start|end)-|order-|m[trblxyse]?-)/.test(t);
const compact=(file,cls)=>/PurchaseOrdersPage\/components\/wizard\/items|components\/ui\/RichTextEditor|canned-response-admin|other-income\/components\/ItemsTable/.test(file)||/\bh-[89]\b|\btext-xs\b/.test(cls);

const fixtures=[];
for(const file of files){ const a=ast(file);let i=0;const walk=n=>{ if(ts.isJsxOpeningElement(n)&&n.tagName.getText(a)==='NativeSelect'){const attr=name=>n.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(a)===name)?.initializer;fixtures.push({id:fixtures.length,file,index:i++,className:expr(attr('className'),file),wrapperClassName:expr(attr('wrapperClassName'),file),density:expr(attr('density'),file)||'default'});}ts.forEachChild(n,walk);};walk(a);}
fs.writeFileSync(out+'/fixtures.json',JSON.stringify(fixtures,null,2));console.log('fixtures',fixtures.length);
