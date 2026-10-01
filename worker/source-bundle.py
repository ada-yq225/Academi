"""Preserve source pages and add an explicit provenance cover and footer margin."""
import io,json,re,sys,os
from pathlib import Path
from pypdf import PdfReader,PdfWriter,Transformation
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(sys.argv[1]);font=os.environ.get('CJK_FONT','/System/Library/Fonts/Supplemental/Arial Unicode.ttf');pdfmetrics.registerFont(TTFont('SourceLabel',font))
ai=PdfReader(root/'ai-report.pdf');sim=PdfReader(root/'similarity-report.pdf')
a=re.search(r'(\d+(?:\.\d+)?)%\s*detected as AI',ai.pages[0].extract_text(),re.I)
s=re.search(r'(\d+(?:\.\d+)?)%\s*Overall Similarity',sim.pages[0].extract_text(),re.I)
if not a or not s:raise ValueError('Cannot identify source scores; refusing to invent results')
scores={'aiScore':float(a[1]),'similarityScore':float(s[1])};(root/'scores.json').write_text(json.dumps(scores))
writer=PdfWriter();buf=io.BytesIO();c=canvas.Canvas(buf,pagesize=(612,792));c.setFillColorRGB(.05,.24,.28);c.rect(0,592,612,200,fill=1,stroke=0);c.setFillColorRGB(1,1,1);c.setFont('Helvetica-Bold',24);c.drawString(44,729,'PaperDesk');c.setFont('SourceLabel',22);c.drawString(44,677,'文稿检测报告');c.setFont('SourceLabel',13);c.drawString(44,642,'ACADEMI.CX 来源 | 非官方重排测试版');c.setFillColorRGB(.08,.18,.22);c.setFont('SourceLabel',17);c.drawString(44,532,f"AI 检测：{scores['aiScore']:g}%");c.drawString(315,532,f"相似度：{scores['similarityScore']:g}%");c.setFont('SourceLabel',12)
for i,line in enumerate(['检测结果来源于 ACADEMI.CX。','AI 为该站自有模型结果，相似度来源以原始下载件为准。','此文件仅重新编排呈现，不代表 Turnitin 官方出具或认证。','后附下载的原始报告内容，分数、正文与原始高亮保持不变。','新增页脚用于清晰标注来源，原始页面整体上移，不遮挡内容。']):c.drawString(44,455-i*29,line)
c.setStrokeColorRGB(.83,.89,.9);c.line(44,102,568,102);c.setFont('SourceLabel',10);c.drawString(44,77,'ACADEMI.CX | 非官方重排测试版');c.save();writer.add_page(PdfReader(buf).pages[0])
for source in [ai,sim]:
 for page in source.pages:
  w=float(page.mediabox.width);h=float(page.mediabox.height)
  new=writer.add_blank_page(width=w,height=h+34);new.merge_transformed_page(page,Transformation().translate(0,34))
  footer=io.BytesIO();fc=canvas.Canvas(footer,pagesize=(w,h+34));fc.setFillColorRGB(.95,.97,.97);fc.rect(0,0,w,34,fill=1,stroke=0);fc.setFillColorRGB(.13,.38,.4);fc.setFont('SourceLabel',10);fc.drawString(18,12,'ACADEMI.CX 来源 | 非官方重排测试版');fc.setFont('Helvetica',9);fc.drawRightString(w-18,12,f'{len(writer.pages)}');fc.save();new.merge_page(PdfReader(footer).pages[0])
writer.add_metadata({'/Title':'PaperDesk - ACADEMI.CX - Non-official layout test','/Author':'PaperDesk','/Subject':'Source-preserving report compilation, not an official Turnitin report'})
with (root/'restyled.pdf').open('wb') as f:writer.write(f)
check=PdfReader(root/'restyled.pdf');assert len(check.pages)==1+len(ai.pages)+len(sim.pages)
for page in check.pages:assert 'ACADEMI.CX' in page.extract_text()
