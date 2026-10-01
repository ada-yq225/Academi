"""Dynamic version of the earlier v3 layout study: original results, explicit provenance."""
import io,json,re,sys,os,hashlib
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,Color
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader,PdfWriter,Transformation
from report_brand import draw_brand
ROOT=Path(sys.argv[1]);FONTS=Path(__file__).parent/'fonts';W,H=612,792
for name in ['LexendMedium','LexendSemiBold','NotoRegular','NotoSemiBold']:pdfmetrics.registerFont(TTFont(name,str(FONTS/(name+'.ttf'))))
pdfmetrics.registerFont(TTFont('SourceCJK',os.getenv('CJK_FONT','/System/Library/Fonts/Supplemental/Arial Unicode.ttf')))
source=json.loads((ROOT/'source.json').read_text()) if (ROOT/'source.json').exists() else {}
job=json.loads((ROOT/'job.json').read_text()) if (ROOT/'job.json').exists() else {}
filename=job.get('filename',source.get('filename','Source document'))
kinds=['ai'] if '--ai-only' in sys.argv[2:] else ['ai','similarity']
readers={t:PdfReader(ROOT/(t+'-report.pdf')) for t in kinds}
texts={t:r.pages[0].extract_text() for t,r in readers.items()}
patterns={'ai':r'(\d+(?:\.\d+)?)\s*%\s*detected as AI','similarity':r'(\d+(?:\.\d+)?)\s*%\s*Overall Similarity'}
scores={}
for t in kinds:
 p=patterns[t]
 m=re.search(p,texts[t],re.I)
 if not m or not 0<=float(m[1])<=100:raise ValueError('Source '+t+' score missing; no result will be invented')
 scores[t]=float(m[1])
words=re.search(r'Word Count:\s*([\d,]+)',texts['ai'])
generated=re.search(r'Report generated:\s*([^\n]+)',texts['ai'])
ink='#202020';muted='#666666';accent='#147D92'
def text(c,x,y,s,size=8,font='NotoRegular',color=ink):
 s=str(s);font='SourceCJK' if any(ord(ch)>0x2fff for ch in s) else font
 c.setFillColor(HexColor(color));c.setFont(font,size);c.drawString(x,y,s)
def lines(c,s,x,y,width,size=8,font='NotoRegular',leading=11,color=ink):
 font='SourceCJK' if any(ord(ch)>0x2fff for ch in str(s)) else font
 for line in simpleSplit(str(s),font,size,width):text(c,x,y,line,size,font,color);y-=leading
 return y
def sheet(draw):
 b=io.BytesIO();c=canvas.Canvas(b,pagesize=(W,H));draw(c);c.save();b.seek(0);return PdfReader(b).pages[0]
def rail(c,n,total,label):
 draw_brand(c,W,H)
 for y in [34]:
  text(c,36,y,'ACADEMI.CX',9,'NotoSemiBold',accent)
  text(c,111,y,f'Page {n} of {total} - {label}',6)
def create(kind):
 original=readers[kind];total=len(original.pages)+2;title='AI Writing' if kind=='ai' else 'Similarity';score=scores[kind];original_file=ROOT/(kind+'-report.pdf')
 def cover(c):
  rail(c,1,total,'Cover Page');text(c,36,436,title+' Report',20,'LexendSemiBold')
  lines(c,filename,36,406,530,17,'LexendMedium',18)
  text(c,56,386,'Source report: ACADEMI.CX',8,color=muted)
  c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5);c.line(36,367,576,367)
  text(c,36,338,'Document Details',10,'NotoSemiBold')
  pairs=[('Local task reference',(job.get('id') or 'Local test')[:32]),('Source report generated',generated[1] if generated else 'See original source report'),('Report source','ACADEMI.CX'),('Original report size',f'{original_file.stat().st_size/1024:.1f} KB')]
  y=310
  for label,value in pairs:text(c,36,y,label,7,color=muted);lines(c,value,36,y-15,345,7,'NotoSemiBold',10);y-=36
  c.setFillColor(Color(.97265625,.97265625,.97265625));c.rect(403,233,130,78,fill=1,stroke=0)
  for yy,s in [(290,f'{len(original.pages)} source report pages'),(268,(words[1]+' words (reported)') if words else 'Word count: see source'),(246,f'{score:g}% '+('AI' if kind=='ai' else 'similarity')+' (source result)')]:text(c,416,yy,s,7,'NotoSemiBold')
 def overview(c):
  rail(c,2,total,title+' Overview');c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5)
  for y in [732,644,592,528]:c.line(36,y,576,y)
  text(c,36,694,f'{score:g}% '+('detected as AI' if kind=='ai' else 'overall similarity'),17,'LexendMedium')
  lines(c,'This value is reproduced from the ACADEMI.CX source report without recalculation.',36,674,255,7,'NotoRegular',9)
  c.setFillColor(Color(.81640625,.91015625,.9765625));c.roundRect(306,659,273,56,8,fill=1,stroke=0)
  text(c,318,700,'Source result - non-official presentation',6,'NotoSemiBold')
  lines(c,'This copy changes presentation only. It is not issued or certified by Turnitin. Review the attached original pages for evidence.',318,685,247,6,'NotoRegular',8)
  c.setFillColor(HexColor('#80D0EF'));c.circle(42,617,6,fill=1,stroke=0)
  text(c,52,618,'AI indicator from source report' if kind=='ai' else 'Overall similarity from source report',7,'NotoSemiBold');text(c,256,618,f'{score:g}%',7)
  text(c,52,606,'Original source pages and visible highlight marks are retained below.',7,color=muted)
  text(c,36,566,'Source and interpretation',6,'NotoSemiBold',muted)
  lines(c,'ACADEMI.CX uses its own AI model. Similarity provider attribution follows the source report and has not been independently verified. All original pages are attached, including the original summary. No author, institutional identity, official submission ID, or new matching source has been invented.',36,555,540,6,'NotoRegular',8,muted)
 writer=PdfWriter();writer.add_page(sheet(cover));writer.add_page(sheet(overview))
 for i,src in enumerate(original.pages,start=3):
  # Keep source content intact inside a reserved frame; add rails outside it.
  page=writer.add_blank_page(W,H);sw=float(src.mediabox.width);sh=float(src.mediabox.height);scale=min(548/sw,690/sh);x=(W-sw*scale)/2;y=49+(690-sh*scale)/2
  page.merge_transformed_page(src,Transformation().scale(scale).translate(x,y));page.merge_page(sheet(lambda c,n=i:rail(c,n,total,title+' - Original Source')));page.compress_content_streams()
 out=ROOT/(kind+'-restyled.pdf');writer.add_metadata({'/Title':title+' - ACADEMI.CX - Non-official layout test','/Author':'PaperDesk','/Subject':f'ACADEMI.CX source; {score:g}%; source-preserving layout v3 dynamic'})
 with out.open('wb') as f:writer.write(f)
 check=PdfReader(out);assert len(check.pages)==total
 for p in check.pages:assert 'ACADEMI.CX' in p.extract_text()
 # The embedding must not drop any source words (ignoring whitespace formatting).
 for i,src in enumerate(original.pages):
  raw=re.sub(r'\s+','',src.extract_text());rendered=re.sub(r'\s+','',check.pages[i+2].extract_text());assert raw in rendered,'Original page text was not preserved'
 return out
outputs=[create(t) for t in kinds];combined=PdfWriter()
for p in outputs:
 for page in PdfReader(p).pages:combined.add_page(page)
with (ROOT/'restyled.pdf').open('wb') as f:combined.write(f)
(ROOT/'scores.json').write_text(json.dumps({'aiScore':scores['ai'],'similarityScore':scores.get('similarity'),'layoutVersion':2}))
(ROOT/'layout-audit.json').write_text(json.dumps({'template':'previous-v3-dynamic','source':'ACADEMI.CX','scores':scores,'originalTextPreserved':True,'sourceHashes':{t:hashlib.sha256((ROOT/(t+'-report.pdf')).read_bytes()).hexdigest() for t in readers},'outputs':{t:len(PdfReader(ROOT/t).pages) for t in [*(k+'-restyled.pdf' for k in kinds),'restyled.pdf']}},indent=2))
print('Repacked source reports with dynamic v3 layout:',scores)

if '--input' in sys.argv[2:]:
 import subprocess
 subprocess.run([sys.executable,str(Path(__file__).with_name('document_layout.py')),str(ROOT),sys.argv[sys.argv.index('--input')+1]],check=True)
