from pathlib import Path
import json, re
import fitz
from PIL import Image, ImageDraw
root=Path('.tmp/document-handoff')
metrics=[]
for file in sorted(root.glob('*.pdf')):
    with fitz.open(file) as doc:
        fonts=set()
        for i,page in enumerate(doc):
            assert page.get_text().strip(), f'{file.name}: blank page'
            assert abs(page.rect.width-595)<2 and abs(page.rect.height-842)<2, file.name
            for b in page.get_text('dict')['blocks']:
                for line in b.get('lines',[]):
                    for s in line['spans']:
                        if not s['text'].strip(): continue
                        fonts.add(s['font'])
                        x0,y0,x1,y1=s['bbox']
                        assert x0>=20 and x1<=page.rect.width-20 and y0>=15 and y1<=page.rect.height-15, (file.name,i,s['text'])
            page.get_pixmap(matrix=fitz.Matrix(1,1)).save(root/f'{file.stem}-{i+1}.png')
        assert all('Sarabun' in f for f in fonts), (file.name,fonts)
        if file.stem.startswith('goods-'):
            text=re.sub(r'\s+','',doc[-1].get_text())
            assert all(word in text for word in ['ตรวจรับทั้งหมด','ผู้รับของ','ผู้ตรวจสอบ']), file.name
            if file.stem in ['goods-0','goods-3']: assert len(doc)==1,file.name
        metrics.append({'name':file.name,'pages':len(doc),'fonts':sorted(fonts),'boundsWarnings':[]})
def geometry(file):
    with fitz.open(root/file) as doc:
        return [[(s['text'],tuple(round(v,2) for v in s['bbox'])) for b in page.get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans']] for page in doc]
assert geometry('goods-3.pdf')==geometry('goods-repeat.pdf')
Path('docs/review/2026-09-11-document-handoff/pdf-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+'\n')
out=fitz.open();toc=[]
for name,title in [('goods-3','ใบรับของ - ตัวอย่าง 3 รายการ'),('goods-20','ใบรับของ - ตัวอย่าง 20 รายการ')]:
    with fitz.open(root/f'{name}.pdf') as doc:
        toc.append([1,title,len(out)+1]);out.insert_pdf(doc)
out.set_toc(toc);out.set_metadata({'title':'BESTCHOICE - Goods receipt samples','subject':'Synthetic test data only; natural A4 spacing; TH Sarabun PSK.'})
out.save('output/pdf/BESTCHOICE-goods-receipt.pdf',garbage=4,deflate=True)
sheet=Image.new('RGB',(600*min(len(out),3),870*((len(out)+2)//3)),'#e4e7e5');draw=ImageDraw.Draw(sheet)
for i,page in enumerate(out):
    path=root/f'final-{i+1}.png';page.get_pixmap(matrix=fitz.Matrix(1,1)).save(path)
    sheet.paste(Image.open(path),(i%3*600,i//3*870+25));draw.text((i%3*600+5,i//3*870+5),f'Page {i+1}',fill='black')
sheet.save('docs/review/2026-09-11-document-handoff/samples.png')
print(json.dumps({'pdfs':len(metrics),'pages':sum(x['pages'] for x in metrics),'samples':len(out),'checks':'PASS'},ensure_ascii=False))
