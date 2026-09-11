"""Render every page of the owner-facing PDF and its two contact sheets."""
from pathlib import Path
import fitz
from PIL import Image, ImageDraw
out = Path('.tmp/document-natural/final')
out.mkdir(parents=True, exist_ok=True)
with fitz.open('output/pdf/BESTCHOICE-document-natural.pdf') as doc:
    for i, page in enumerate(doc):
        page.get_pixmap(matrix=fitz.Matrix(1,1)).save(out / f'page-{i+1}.png')
    for first in range(0,len(doc),12):
        indices = list(range(first,min(first+12,len(doc))))
        sheet = Image.new('RGB',(1200,((len(indices)+3)//4)*453),'#e4e7e5')
        draw = ImageDraw.Draw(sheet)
        for k, i in enumerate(indices):
            im = Image.open(out / f'page-{i+1}.png')
            im.thumbnail((294,416))
            x,y = k%4*300,k//4*453
            sheet.paste(im,(x,y+28))
            draw.text((x+5,y+6),f'Page {i+1}',fill='black')
        sheet.save(out / f'contact-{first//12+1}.png')
    print(len(doc),'final pages rendered')
