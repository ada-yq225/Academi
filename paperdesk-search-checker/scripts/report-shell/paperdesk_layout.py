"""Independent-check input adapter for the existing v3 report shell.

Reuses the Letter cover/overview geometry, fonts, evidence frame and page merge
from restyle.py. Scores and highlighted evidence come from server results.
"""
import argparse,io,json,hashlib,re,os
from pathlib import Path
from datetime import datetime,timezone,timedelta
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from html import escape
from pypdf import PdfReader,PdfWriter,Transformation
from pypdf.generic import ArrayObject,FloatObject,NameObject

from report_brand import draw_brand

W,H=612,792
ink='#202020';muted='#666666';accent='#147D92'

def main():
 a=argparse.ArgumentParser();a.add_argument('--paperdesk',action='store_true');a.add_argument('--input',required=True);a.add_argument('--evidence',required=True);a.add_argument('--output',required=True);a.add_argument('--title',default='提交文稿');args=a.parse_args()
 root=Path(__file__).parent
 for name in ['LexendMedium','LexendSemiBold','NotoRegular','NotoSemiBold']:pdfmetrics.registerFont(TTFont(name,str(root/'fonts'/(name+'.ttf'))))
 font=os.getenv('CJK_FONT','/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
 if Path(font).exists():pdfmetrics.registerFont(TTFont('SourceCJK',font))
 else:pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
 cjk='SourceCJK' if Path(font).exists() else 'STSong-Light'
 data=json.loads(Path(args.input).read_text());original=PdfReader(args.evidence);total=len(original.pages)+2
 value=data.get('similarity');score='不可判定' if value is None else f'{value:g}%'
 coverage=data.get('coverage',{});result=data.get('results',[]);matched=sum(bool(r.get('spans')) for r in result)
 identifier='PD-'+hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:12].upper()
 try:date=datetime.fromisoformat(data.get('generatedAt','').replace('Z','+00:00')).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M UTC+8')
 except ValueError:date='未记录时间'
 def font_for(s,font):return cjk if any(ord(ch)>0x2fff for ch in str(s)) else font
 def text(c,x,y,s,size=8,font='NotoRegular',color=ink):
  c.setFillColor(HexColor(color));c.setFont(font_for(s,font),size);c.drawString(x,y,str(s))
 def lines(c,s,x,y,width,size=8,font='NotoRegular',leading=11,color=ink):
  style=ParagraphStyle('shell',fontName=font_for(s,font),fontSize=size,leading=leading,textColor=HexColor(color),wordWrap='CJK' if font_for(s,font)==cjk else None)
  p=Paragraph(escape(str(s)).replace('\n','<br/>'),style);_,height=p.wrap(width,H);p.drawOn(c,x,y-height+size);return y-height
 sheets=[]
 def sheet(draw):
  b=io.BytesIO();c=canvas.Canvas(b,pagesize=(W,H));draw(c);c.save();b.seek(0);reader=PdfReader(b);sheets.append(reader);return reader.pages[0]
 def rail(c,n,label):
  draw_brand(c,W,H)
  text(c,166,H-34,'PaperDesk 自主查重 · 非 Turnitin 官方报告',8,color=accent)
  text(c,36,34,f'Page {n} of {total} - {label}',6)
  text(c,36,18,'PaperDesk public-source matching | Not a Turnitin-issued report',6,'NotoSemiBold',muted)
 def cover(c):
  rail(c,1,'Cover Page');text(c,36,436,'Similarity Report',20,'LexendSemiBold')
  # Preserve the legacy title baseline; bound the block so long names cannot
  # overlap the Document Details separator.
  name=args.title;size=17
  while size>9 and pdfmetrics.stringWidth(name,font_for(name,'LexendMedium'),size)>1060:size-=1
  lines(c,name,36,406,530,size,'LexendMedium',size+2)
  text(c,56,373,'检测来源：PaperDesk 自主公开来源检索',8,color=muted)
  c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5);c.line(36,355,576,355)
  text(c,36,338,'Document Details',10,'NotoSemiBold')
  status={'complete':'已尝试来源未报告错误','partial':'部分来源未获取','unavailable':'未获得可比对来源'}.get(data.get('status'),'未知')
  pairs=[('Report reference',identifier),('Report generated',date),('Detection source','PaperDesk / Public internet sources'),('Retrieval status',status)]
  for j,(label,val) in enumerate(pairs):
   text(c,36,310-j*36,label,7,color=muted);lines(c,val,36,295-j*36,345,7,'NotoSemiBold',10)
  c.setFillColor(Color(.97265625,.97265625,.97265625));c.rect(403,233,130,78,fill=1,stroke=0)
  for yy,s in [(290,f'{len(result)} sentences'),(268,f'{coverage.get("readableSources",0)} readable sources'),(246,score+' similarity')]:text(c,416,yy,s,7,'NotoSemiBold')
  lines(c,'来源范围：公开网页、开放论文全文及摘要。分数仅衡量已获取来源中的文字重复，不能代表全互联网覆盖。',36,132,540,8,leading=12,color=muted)
 def overview(c):
  rail(c,2,'Similarity Overview');c.setStrokeColor(HexColor('#BFBFBF'));c.setLineWidth(.5)
  for y in [732,644,592,528]:c.line(36,y,576,y)
  text(c,36,694,score+' overall similarity',17,'LexendMedium')
  lines(c,'已获取来源中的文字重复占比；重叠来源只计一次。',36,674,255,8,leading=11)
  c.setFillColor(Color(.81640625,.91015625,.9765625));c.roundRect(306,659,273,56,8,fill=1,stroke=0)
  text(c,318,700,'Independent detection - source evidence retained',6,'NotoSemiBold')
  lines(c,'PaperDesk 自主查重；非 Turnitin 官方报告。检索不完整时，低分或 0% 不能判定原创。',318,685,247,7,leading=10)
  c.setFillColor(HexColor('#80D0EF'));c.circle(42,617,6,fill=1,stroke=0)
  text(c,52,618,'Matched sentences',7,'NotoSemiBold');text(c,256,618,str(matched)+' / '+str(len(result)),7)
  text(c,52,606,'Exact text ranges, source links and evidence scope follow below.',7,color=muted)
  text(c,36,566,'Source and interpretation',8,'NotoSemiBold',muted)
  lines(c,'匹配高亮来自自主检索和文字比对，不包含 AI 判断。证据会区分全文、摘要和网页；摘要匹配不会冒充全文匹配。未高亮不等于原创，匹配也不能单独作为抄袭结论。',36,550,540,8,leading=12,color=muted)
  text(c,36,469,'Retrieval coverage',10,'NotoSemiBold')
  fields=[('文稿句子 / 查询片段',f'{coverage.get("sentences",len(result))} / {coverage.get("querySentences",0)}'),('候选 / 尝试读取',f'{coverage.get("candidates",0)} / {coverage.get("fetchedCandidates",0)}'),('全文 / 仅摘要来源',f'{coverage.get("fulltextSources",0)} / {coverage.get("abstractOnlySources",0)}'),('匹配有效字符 / 总有效字符',f'{data.get("matchedCharacters",0)} / {data.get("totalCharacters",0)}')]
  for j,(label,val) in enumerate(fields):text(c,36,442-j*28,label,8,color=muted);text(c,306,442-j*28,val,8,'NotoSemiBold')
  lines(c,'后续页仅展示重复片段、来源索引及诊断摘要，省略未匹配文字。报告最多20页；较长的匹配内容可能节选，完整证据见网页/JSON，检测总分不变。',36,282,540,8,leading=12,color=muted)
 writer=PdfWriter();writer.add_page(sheet(cover));writer.add_page(sheet(overview))
 for i,src in enumerate(original.pages,start=3):
  page=writer.add_blank_page(W,H);sw=float(src.mediabox.width);sh=float(src.mediabox.height);scale=1 if (sw,sh)==(W,H) else min(548/sw,690/sh);x=(W-sw*scale)/2;y=0 if scale==1 else 49+(690-sh*scale)/2
  page.merge_transformed_page(src,Transformation().scale(scale).translate(x,y));page.merge_page(sheet(lambda c,n=i:rail(c,n,'Detailed Evidence')));page.compress_content_streams()
 # merge_transformed_page imports destination objects but those imported pages
 # are not part of the output page tree. Repoint every internal link to its
 # actual appended evidence page and transform the destination coordinates.
 source_pages={p.indirect_reference.idnum:i for i,p in enumerate(original.pages)}
 for i,src in enumerate(original.pages):
  for source_ann,ann in zip(src.get('/Annots',[]),writer.pages[i+2].get('/Annots',[])):
   source_ann=source_ann.get_object();ann=ann.get_object();dest=source_ann.get('/Dest')
   if isinstance(dest,ArrayObject) and getattr(dest[0],'idnum',None) in source_pages:
    target_index=source_pages[dest[0].idnum];target_src=original.pages[target_index];sw=float(target_src.mediabox.width);sh=float(target_src.mediabox.height)
    scale=1 if (sw,sh)==(W,H) else min(548/sw,690/sh);x=(W-sw*scale)/2;y=0 if scale==1 else 49+(690-sh*scale)/2
    converted=ArrayObject([writer.pages[target_index+2].indirect_reference,*dest[1:]])
    if str(dest[1])=='/XYZ':
     if len(dest)>2 and isinstance(dest[2],(int,float)):converted[2]=FloatObject(float(dest[2])*scale+x)
     if len(dest)>3 and isinstance(dest[3],(int,float)):converted[3]=FloatObject(float(dest[3])*scale+y)
    ann[NameObject('/Dest')]=converted
 writer.add_metadata({'/Title':args.title+' - PaperDesk Similarity Report','/Author':'PaperDesk','/Subject':'Independent public-source matching; v3 report shell; not issued by Turnitin'})
 out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('wb') as f:writer.write(f)
 check=PdfReader(out);assert len(check.pages)==total
 for i,src in enumerate(original.pages):
  raw=re.sub(r'\s+','',src.extract_text());rendered=re.sub(r'\s+','',check.pages[i+2].extract_text());assert raw in rendered,'Evidence text was not preserved'
 out.with_suffix('.audit.json').write_text(json.dumps({'template':'previous-v3-dynamic-paperdesk','similarity':value,'source':'PaperDesk public-source matching','evidenceTextPreserved':True,'pages':total,'pageSize':[W,H],'inputHash':hashlib.sha256(Path(args.input).read_bytes()).hexdigest()},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
