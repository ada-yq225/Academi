"""Preserve input document pages and map source AI highlights onto matching text.
Called by restyle.py --input. Refuses mismatched text instead of inventing highlights.
"""
import os,sys,re,json,subprocess,tempfile,shutil,io,unicodedata
from pathlib import Path
import pymupdf as fitz
from report_brand import draw_brand
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(sys.argv[1]);original=Path(sys.argv[2]).resolve();fontdir=Path(__file__).parent/'fonts'
for n in ['NotoRegular','NotoSemiBold']:pdfmetrics.registerFont(TTFont(n,str(fontdir/(n+'.ttf'))))
if original.suffix.lower()=='.pdf':rendered=original
else:
 binary=os.environ.get('SOFFICE_BIN') or shutil.which('soffice')
 bundled=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice'
 if not binary and bundled.exists():binary=str(bundled)
 if not binary:raise RuntimeError('DOCX rendering requires LibreOffice; set SOFFICE_BIN')
 # Preserve explicit font choices; missing fonts must not silently change pagination.
 from zipfile import ZipFile
 import xml.etree.ElementTree as ET
 w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
 with ZipFile(original) as z:
  xml=ET.fromstring(z.read('word/document.xml'))
  required={el.get(w+k) for el in xml.iter(w+'rFonts') for k in ['ascii','hAnsi','eastAsia'] if el.get(w+k)}
 fc=shutil.which('fc-match') or ('/opt/homebrew/bin/fc-match' if Path('/opt/homebrew/bin/fc-match').exists() else None)
 font_env=os.environ.copy()
 if sys.platform=='darwin' and Path('/opt/homebrew/etc/fonts/fonts.conf').exists():font_env.setdefault('FONTCONFIG_FILE','/opt/homebrew/etc/fonts/fonts.conf')
 missing=[]
 for family in required:
  if not fc:raise RuntimeError('Font verification requires fontconfig/fc-match')
  base=re.sub(r' (Bold Italic|Bold|Italic|Regular)$','',family,flags=re.I)
  found=subprocess.check_output([fc,'-f','%{family}',base],env=font_env,text=True)
  if base.casefold() not in [x.strip().casefold() for x in found.split(',')]:missing.append(family)
 if missing:raise RuntimeError('Missing document fonts: '+', '.join(sorted(missing))+'. Install them or upload a PDF exported from the original editor; no silent font substitution.')
 with tempfile.TemporaryDirectory(prefix='pd-render-') as tmp:
  args=[binary,'-env:UserInstallation='+Path(tmp,'profile').as_uri(),'--headless','--convert-to','pdf','--outdir',tmp,str(original)]
  render_env=os.environ.copy()
  if sys.platform=='darwin' and not render_env.get('FONTCONFIG_FILE') and Path('/opt/homebrew/etc/fonts/fonts.conf').exists():render_env['FONTCONFIG_FILE']='/opt/homebrew/etc/fonts/fonts.conf'
  from xml.sax.saxutils import escape
  base_config=render_env.get('FONTCONFIG_FILE','/etc/fonts/fonts.conf')
  rules=[]
  for family in required:
   m=re.match(r'^(.*) (Bold Italic|Bold|Italic|Regular)$',family,re.I)
   if m:rules.append('<match target="pattern"><test name="family" compare="eq"><string>'+escape(family)+'</string></test><edit name="family" mode="assign"><string>'+escape(m[1])+'</string></edit><edit name="style" mode="assign"><string>'+escape(m[2])+'</string></edit></match>')
  config=Path(tmp,'fonts.conf');config.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include>'+escape(base_config)+'</include>'+''.join(rules)+'</fontconfig>')
  render_env['FONTCONFIG_FILE']=str(config)
  subprocess.run(args,check=True,timeout=120,capture_output=True,env=render_env)
  made=Path(tmp,original.stem+'.pdf')
  if not made.exists():raise RuntimeError('DOCX renderer did not produce PDF')
  rendered=root/'original-layout.pdf';shutil.copy2(made,rendered)
doc=fitz.open(rendered);source=fitz.open(root/'ai-report.pdf')
def normalize(c):return ''.join(ch.lower() for ch in unicodedata.normalize('NFKC',c) if ch.isalnum())
def chars(page,clip=None):
 for b in page.get_text('rawdict',clip=clip)['blocks']:
  for l in b.get('lines',[]):
   for s in l['spans']:
    for c in s['chars']:
     yield c,l['bbox']
stream=[];classes=[]
for p in list(source)[1:]:
 colored=[]
 for d in p.get_drawings():
  f=d.get('fill')
  if f and d['rect'].height<40 and max(f)-min(f)>.06:
   colored.append((d['rect'],tuple(f)))
 for c,line in chars(p,fitz.Rect(0,55,p.rect.width,p.rect.height-45)):
  r=fitz.Rect(c['bbox']);mid=(r.tl+r.br)/2;fill=next((col for box,col in colored if box.contains(mid)),None)
  for x in normalize(c['c']):stream.append(x);classes.append(fill)
target=[];placements=[]
for i,p in enumerate(doc):
 for c,line in chars(p):
  for x in normalize(c['c']):target.append(x);placements.append((i,c['bbox'],line))
if ''.join(stream)!=''.join(target):
 raise RuntimeError('Original document and source report text do not align; original layout retained separately, automatic highlights refused')
# Join adjacent characters on the same visual line and with the same source class.
groups=[]
for place,col in zip(placements,classes):
 if not col:continue
 i,box,line=place;r=fitz.Rect(box)
 if groups and groups[-1][0]==i and groups[-1][1]==line and groups[-1][2]==col and r.x0-groups[-1][3].x1<15:groups[-1][3]|=r
 else:groups.append([i,line,col,r])
for i,line,col,r in groups:
 # Source classes are preserved; only the display color follows the comparison theme.
 color=(.32,.777,.855) if col[2]>col[0] and col[1]>col[0]+.08 else col
 existing=any(d.get('fill') and max(d['fill'])-min(d['fill'])>.06 and d['rect'].contains((r.tl+r.br)/2) for d in doc[i].get_drawings())
 if not existing:doc[i].draw_rect(r,color=None,fill=color,fill_opacity=.35,overlay=True)
def rail(w,h,n,total):
 b=io.BytesIO();c=canvas.Canvas(b,pagesize=(w,h));c.setFillColorRGB(.08,.49,.57);c.setFont('NotoSemiBold',9)
 draw_brand(c,w,h)
 for y in [35]:
  c.drawString(36,y,'ACADEMI.CX');c.setFillColorRGB(.12,.12,.12);c.setFont('NotoRegular',6);c.drawString(107,y,f'Page {n} of {total} - AI Writing Submission');c.setFillColorRGB(.08,.49,.57);c.setFont('NotoSemiBold',9)
 c.save();return fitz.open(stream=b.getvalue(),filetype='pdf')
# Front pages are generated by the existing source-aware template.
front=fitz.open(root/'ai-restyled.pdf');result=fitz.open();result.insert_pdf(front,from_page=0,to_page=1);total=len(doc)+2
for i,p in enumerate(doc):
 # Do not obscure uploaded content in the header/footer zones.
 occupied=any(fitz.Rect(c['bbox']).intersects(fitz.Rect(30,20,360,45)) or fitz.Rect(c['bbox']).intersects(fitz.Rect(30,p.rect.height-45,300,p.rect.height-25)) for c,_ in chars(p))
 if not occupied:p.show_pdf_page(p.rect,rail(p.rect.width,p.rect.height,i+3,total),0)
 result.insert_pdf(doc,from_page=i,to_page=i)
# Update page totals and document-page statistics on the front only.
for page in result[:2]:
 for term in [f'of {len(front)}']:
  for box in page.search_for(term):
   page.add_redact_annot(box,fill=(1,1,1));page.apply_redactions();page.insert_text((box.x0,box.y1-1),f'of {total}',fontsize=6,fontname='helv')
# Keep the page count field factual, now describing original document pages.
p=result[0]
for box in p.search_for(f'{len(source)} source report pages'):
 p.add_redact_annot(box,fill=(.973,.973,.973));p.apply_redactions();p.insert_text((box.x0,box.y1-1),f'{len(doc)} document pages',fontsize=7)
result.set_metadata({'title':'AI Writing Report - '+original.name,'author':'PaperDesk','subject':'ACADEMI.CX results; original document layout; non-official presentation'})
tmp=root/'ai-layout-v4.pdf';result.save(tmp,garbage=4,deflate=True);result.close();front.close();os.replace(tmp,root/'ai-restyled.pdf')
combined=fitz.open(root/'ai-restyled.pdf')
if (root/'similarity-restyled.pdf').exists():combined.insert_pdf(fitz.open(root/'similarity-restyled.pdf'))
tmp=root/'combined-v4.pdf';combined.save(tmp);combined.close();os.replace(tmp,root/'restyled.pdf')
scores=json.loads((root/'scores.json').read_text());scores['layoutVersion']=3;(root/'scores.json').write_text(json.dumps(scores))
(root/'original-layout-audit.json').write_text(json.dumps({'layoutVersion':3,'textAligned':True,'originalPages':len(doc),'outputPages':total,'mappedHighlightRuns':len(groups),'inputType':original.suffix.lower(),'layoutInput':original.name,'pageSizes':[[p.rect.width,p.rect.height] for p in doc]},indent=2))
audit=json.loads((root/'layout-audit.json').read_text())
audit['template']='original-layout-v4'
audit['outputs']={name:len(fitz.open(root/name)) for name in audit['outputs']}
audit['originalDocumentTextAligned']=True
(root/'layout-audit.json').write_text(json.dumps(audit,indent=2))
print('Original-layout v4:',len(doc),'document pages;',len(groups),'highlight runs; input:',original.name)
