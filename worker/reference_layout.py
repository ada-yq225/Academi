"""Reference-assisted layout comparison. Requires an exact body-text match.
Usage: python reference_layout.py SOURCE_AI.pdf REFERENCE.pdf OUTPUT.pdf
Requires PyMuPDF, pdfplumber, reportlab. Does not perform AI detection.
"""
import sys,re,io,json,hashlib
from pathlib import Path
import fitz,pdfplumber
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
src,ref,out=map(Path,sys.argv[1:4]);fonts=Path(__file__).parent/'fonts'
for n in ['LexendMedium','LexendSemiBold','NotoRegular','NotoSemiBold']:pdfmetrics.registerFont(TTFont(n,str(fonts/(n+'.ttf'))))
pdfmetrics.registerFont(TTFont('CJK','/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
def body(p):return p.crop((0,60,p.width,p.height-60)).extract_text() or ''
def norm(t):return re.sub(r'[^\w]','',t).lower()
with pdfplumber.open(src) as d:
 source_text=d.pages[0].extract_text();source_body=''.join(body(p) for p in d.pages[1:])
with pdfplumber.open(ref) as d:reference_body=''.join(body(p) for p in d.pages[2:])
assert norm(source_body)==norm(reference_body),'Reference body differs from source; cannot use reference pagination'
score=re.search(r'(\d+(?:\.\d+)?)%\s*detected as AI',source_text)[1]
words=re.search(r'Word Count:\s*([\d,]+)',source_text)[1]
refdoc=fitz.open(ref);total=len(refdoc)
def text(c,x,y,s,size=7,font='NotoRegular',color='#202020'):
 font='CJK' if any(ord(ch)>0x2fff for ch in s) else font
 c.setFont(font,size);c.setFillColor(HexColor(color));c.drawString(x,y,s)
def lines(c,s,x,y,w,size=7,leading=10,font='NotoRegular',color='#202020'):
 for l in simpleSplit(s,font,size,w):text(c,x,y,l,size,font,color);y-=leading

def rail(c,w,h,n,label):
 for y in [h-35,35]:text(c,36,y,'ACADEMI.CX',9,'NotoSemiBold','#147D92');text(c,107,y,f'Page {n} of {total} - {label}',6)

def draw(c,i):
 rail(c,612,792,i+1,'Cover Page' if i==0 else 'AI Writing Overview')
 if i==0:
  text(c,36,436,'AI Writing Report',20,'LexendSemiBold');text(c,36,406,'Group Project作业',17,'LexendMedium');text(c,56,386,'ACADEMI.CX source report',8,color='#666666')
  c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5);c.line(36,367,576,367)
  text(c,36,338,'Document Details',10,'NotoSemiBold')
  details=[('Report source','ACADEMI.CX'),('Report generated',re.search(r'Report generated:\s*([^\n]+)',source_text)[1]),('Layout reference','User-provided PDF; matching document text'),('File Name','Group Project作业.docx'),('Document Size',re.search(r'Document Size:\s*([^\n]+)',source_text)[1])]
  for j,(a,b) in enumerate(details):text(c,36,310-j*36,a,7,color='#666666');text(c,36,296-j*36,b,7,'NotoSemiBold')
  c.setFillColor(HexColor('#F9F9F9'));c.rect(403,244,110,78,fill=1,stroke=0)
  for j,s in enumerate([f'{total-2} document pages',f'{words} words (source)',f'{score}% AI (source)']):text(c,415,298-j*22,s,7,'NotoSemiBold')
 else:
  c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5)
  for y in [732,644,592,528]:c.line(36,y,576,y)
  text(c,36,694,f'{score}% detected as AI',17,'LexendMedium')
  lines(c,'AI percentage copied from the ACADEMI.CX report. Layout and highlight positions follow the supplied reference PDF.',36,683,263,7,10)
  c.setFillColor(HexColor('#D1E8FA'));c.roundRect(306,660,273,56,8,fill=1,stroke=0)
  text(c,318,700,'Source and interpretation',6,'NotoSemiBold')
  lines(c,'This is a local layout comparison using ACADEMI.CX results. It is not issued or certified by Turnitin. AI detection is probabilistic.',318,684,247,6,8)
  c.setFillColor(HexColor('#52C6DA'));c.circle(42,618,6,fill=1,stroke=0)
  text(c,52,618,'1  AI-generated  '+score+'%',7);text(c,52,608,'Classification follows the source AI report.',7,color='#666666')
  text(c,36,568,'Report provenance',6)
  lines(c,'The original ACADEMI.CX AI report is the source of the score. The body text has been checked against the user-provided reference and is identical after whitespace and punctuation normalization. Body pagination, fonts and highlight geometry reuse that reference. Reference author names, official branding and submission identifiers have not been copied into this presentation.',36,558,540,6,8,color='#666666')
buf=io.BytesIO();c=canvas.Canvas(buf,pagesize=(612,792))
for i in range(2):draw(c,i);c.showPage()
c.save();output=fitz.open(stream=buf.getvalue(),filetype='pdf')
for index in range(2,len(refdoc)):
 p=refdoc[index];w,h=p.rect.width,p.rect.height
 p.add_redact_annot(fitz.Rect(0,0,w,60),fill=(1,1,1));p.add_redact_annot(fitz.Rect(0,h-60,w,h),fill=(1,1,1));p.apply_redactions()
 layer=io.BytesIO();cv=canvas.Canvas(layer,pagesize=(w,h));rail(cv,w,h,index+1,'AI Writing Submission');cv.save();ov=fitz.open(stream=layer.getvalue(),filetype='pdf');p.show_pdf_page(p.rect,ov,0)
 output.insert_pdf(refdoc,from_page=index,to_page=index)
output.set_metadata({'title':'Group Project - ACADEMI.CX - Reference layout comparison','author':'PaperDesk','subject':'ACADEMI.CX score; user-supplied reference pagination and highlights; not an official Turnitin report'})
out.parent.mkdir(parents=True,exist_ok=True);output.save(out,garbage=4,deflate=True)
check=fitz.open(out);assert len(check)==total
for p in check:
 t=p.get_text();assert 'trn:oid' not in t and 'Ayan Kadam' not in t and 'ACADEMI.CX' in t
out.with_suffix('.audit.json').write_text(json.dumps({'bodyTextMatches':True,'aiScore':float(score),'sourceWordCount':words,'pages':total,'pageSizes':[[p.rect.width,p.rect.height] for p in check],'sourceHash':hashlib.sha256(src.read_bytes()).hexdigest(),'referenceHash':hashlib.sha256(ref.read_bytes()).hexdigest(),'bodyLayoutAndHighlights':'reused from user-supplied matching reference'},indent=2))
print('Generated',out,'pages',total,'score',score)
