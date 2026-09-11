import fitz,json,math
from pathlib import Path
from PIL import Image,ImageDraw
root=Path('.tmp/document-style');pages=[];stats=[]
# Actual page-box bounds for thermal labels; A4 uses a conservative safety inset.
for f in sorted(root.glob('*.pdf')):
 d=fitz.open(f);fontstats={};over=[]
 for i,p in enumerate(d):
  assert p.get_text().strip(), f'{f.name} page {i+1} is blank'
  inset_x, inset_y = (0, 0) if p.rect.width < 200 else (20, 15)
  for b in p.get_text('dict')['blocks']:
   for l in b.get('lines',[]):
    for s in l['spans']:
     if not s['text'].strip():continue
     key=f"{s['font']} {s['size']:.1f}";fontstats[key]=fontstats.get(key,0)+len(s['text'])
     x0,y0,x1,y1=s['bbox']
     # Puppeteer's 12 pt contract footer occupies the reserved bottom margin.
     # Its glyph box ends ~14.5 pt from the edge; body text retains 15 pt safety.
     footer = s['size'] <= 12.01 and y0 > p.rect.height - 57
     bottom_inset = min(inset_y, 10) if footer else inset_y
     if x0<inset_x or x1>p.rect.width-inset_x or y0<inset_y or y1>p.rect.height-bottom_inset:over.append([i+1,s['text'][:60],s['bbox']])
  png=root/f'{f.stem}-{i+1}.png';p.get_pixmap(matrix=fitz.Matrix(1,1)).save(png);pages.append((f'{f.stem} / {i+1}',png))
 stats.append({'name':f.name,'pages':len(d),'fonts':fontstats,'boundsWarnings':over})
for k in range(0,len(pages),12):
 chunk=pages[k:k+12];sheet=Image.new('RGB',(1200,math.ceil(len(chunk)/4)*452),'#ddd');draw=ImageDraw.Draw(sheet)
 for j,(name,png) in enumerate(chunk):
  im=Image.open(png);im.thumbnail((290,415));x=(j%4)*300;y=(j//4)*452;sheet.paste(im,(x,y+28));draw.text((x+3,y+5),name,fill='black')
 sheet.save(root/f'contact-{k//12+1}.png')
(root/'pdf-metrics.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2))
print(json.dumps([{'name':s['name'],'pages':s['pages'],'warnings':len(s['boundsWarnings'])} for s in stats],indent=2))

assert all(not s['boundsWarnings'] for s in stats), 'Text outside safe page bounds'
assert all('Sarabun' in font for s in stats for font in s['fonts']), 'Unexpected fallback font'
