#!/usr/bin/env python3
"""PaperDesk PDF export. Reads server-generated results; never changes scores."""
import argparse, json, re, hashlib
from bisect import bisect_right
from pathlib import Path
from datetime import datetime, timezone, timedelta
from html import escape
from collections import Counter
from urllib.parse import urlsplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak

FONT='PaperDeskUnicode'
font_paths=[Path(__file__).parent.parent/'assets/fonts/ArialUnicode.ttf',Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')]
for file in font_paths:
    if file.exists():
        pdfmetrics.registerFont(TTFont(FONT,str(file)));break
else:
    FONT='STSong-Light';pdfmetrics.registerFont(UnicodeCIDFont(FONT))
INK='#183447';TEAL='#08778C';MUTED='#617887';LINE='#D8E4EB';WIDTH=A4[0]-84
base=ParagraphStyle('body',fontName=FONT,fontSize=9.5,leading=16,textColor=colors.HexColor(INK),spaceAfter=8,splitLongWords=True)
styles={
    'body':base,
    'small':ParagraphStyle('small',parent=base,fontSize=8,leading=12,textColor=colors.HexColor(MUTED),spaceAfter=5),
    'title':ParagraphStyle('title',parent=base,fontSize=23,leading=31,spaceAfter=12,textColor=colors.HexColor(TEAL)),
    'heading':ParagraphStyle('heading',parent=base,fontSize=14,leading=21,spaceBefore=12,spaceAfter=8,textColor=colors.HexColor(TEAL),keepWithNext=True),
    'sub':ParagraphStyle('sub',parent=base,fontSize=10,leading=16,textColor=colors.HexColor(MUTED),spaceBefore=9,spaceAfter=5,keepWithNext=True),
}

def clean(value):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]','',str(value or '')).replace('\u2011','-').replace('\u2013','-').replace('\u2014','-')
def p(text,style='body',markup=False):
    value=clean(text) if markup else escape(clean(text)).replace('\n','<br/>')
    st=styles[style]
    if re.search(r'[\u3400-\u9fff]',value):st=ParagraphStyle('cjk',parent=st,wordWrap=None if '<font backColor=' in value else 'CJK',fontName=FONT)
    return Paragraph(value or ' ',st)
def safe_link(url,label):
    try:
        u=urlsplit(url)
        if u.scheme in ('http','https') and u.hostname and not u.username:
            return '<link href="'+escape(url,quote=True)+'" color="'+TEAL+'">'+escape(clean(label))+'</link>'
    except (TypeError,ValueError):pass
    return escape(clean(label))
def stamp(value):
    try:return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S UTC+8')
    except (ValueError,AttributeError):return '未记录时间'
def footer(c,doc):
    c.saveState();c.setStrokeColor(colors.HexColor(LINE));c.line(42,A4[1]-42,A4[0]-42,A4[1]-42)
    c.setFont(FONT,9);c.setFillColor(colors.HexColor(TEAL));c.drawString(42,A4[1]-31,'PaperDesk  |  自主查重测试版')
    c.setFillColor(colors.HexColor(MUTED));c.setFont(FONT,7);c.drawString(42,25,'公开来源检索与文字匹配；非 Turnitin 官方报告')
    c.drawRightString(A4[0]-42,25,'第 '+str(doc.page)+' 页');c.restoreState()
def table(rows,widths,header=True):
    t=Table([[p(x,'small') if not isinstance(x,Paragraph) else x for x in row] for row in rows],colWidths=widths,repeatRows=1 if header else 0,hAlign='LEFT')
    commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,-1),.35,colors.HexColor(LINE))]
    if header:commands += [('BACKGROUND',(0,0),(-1,0),colors.HexColor('#EAF5F8'))]
    t.setStyle(TableStyle(commands));return t

def highlighted(row):
    text=row.get('text','');out=[];last=0
    offsets=[0]
    for char in text:offsets.append(offsets[-1]+(2 if ord(char)>0xffff else 1))
    position=lambda offset:max(0,min(len(text),bisect_right(offsets,offset)-1))
    spans=sorted(row.get('spans',[]),key=lambda s:s['start'])
    for span in spans:
        a=max(last,position(span['start']));b=max(a,position(span['end']))
        out.append(escape(clean(text[last:a])))
        out.append('<font backColor="#FFE4B7">'+escape(clean(text[a:b]))+'</font>');last=b
    out.append(escape(clean(text[last:])))
    return ''.join(out).replace('\n','<br/>')

def report(data,title,excerpt_budget=60000):
    coverage=data.get('coverage',{});rows=data['results'];matched=[r for r in rows if r.get('spans')]
    source_map={};source_list=[]
    for row in rows:
        for s in row.get('sources',[]):
            key=s.get('id') or s.get('url') or s.get('title')
            if key not in source_map:source_map[key]='S'+str(len(source_list)+1).zfill(2);source_list.append((key,s))
    score='不可判定' if data.get('similarity') is None else str(data['similarity'])+'%'
    status={'complete':'已尝试来源未报告错误','partial':'部分来源未获取','unavailable':'未获得可比对来源'}.get(data.get('status'),'状态未知')
    story=[p(title,'title'),p('自主查重报告 / PUBLIC SOURCE SIMILARITY REPORT','small'),p('检测记录时间：'+stamp(data.get('generatedAt')),'small')]
    identifier=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:12].upper();story.append(p('报告编号：PD-'+identifier+'  |  '+status,'small'))
    story.append(table([[p('<font size="24" color="'+TEAL+'">'+score+'</font><br/>已获取来源中的文字重复占比',markup=True),p('<font size="24" color="'+TEAL+'">'+str(len(matched))+'</font><br/>含匹配片段的句子',markup=True),p('<font size="24" color="'+TEAL+'">'+str(coverage.get('readableSources',0))+'</font><br/>可读取来源条目',markup=True)]],[WIDTH/3]*3,False))
    story.extend([Spacer(1,12),p('分数只衡量已获取来源中的文字重复，不代表全互联网重复率，也不能单独作为抄袭结论。高亮为匹配位置，未高亮不等于原创。','body')])
    if data.get('status')!='complete':story.append(p('<font color="#9C601D">检索不完整：低分或 0% 不能据此判定原创。</font>',markup=True))
    story.append(p('检索范围与方法','heading'))
    story.append(table([['项目','本次记录'],['文稿句子 / 检索片段',str(coverage.get('sentences',len(rows)))+' / '+str(coverage.get('querySentences',0))],['候选 / 尝试读取',str(coverage.get('candidates',0))+' / '+str(coverage.get('fetchedCandidates',0))],['读取全文 / 仅摘要来源',str(coverage.get('fulltextSources',0))+' / '+str(coverage.get('abstractOnlySources',0))],['匹配有效字符 / 总有效字符',str(data.get('matchedCharacters',0))+' / '+str(data.get('totalCharacters',0))]],[170,WIDTH-170]))
    story.append(p('连续英文 5 词、中文片段 10 个 token 为匹配锚点，按原文位置扩展；重叠来源只计一次。引用与参考文献当前同样参与匹配。来源条目可能属于同一论文的不同网址或版本。','small'))
    story.append(PageBreak());story.append(p('重复片段高亮','heading'))
    story.append(p('仅展示已匹配文字，省略未匹配文字；片段序号对应网页原文。总分仍按完整文稿计算。','small'))
    selected=[];remaining=excerpt_budget;omitted=False
    for row in matched:
        text=row.get('text','');offsets=[0]
        for char in text:offsets.append(offsets[-1]+(2 if ord(char)>0xffff else 1))
        position=lambda offset:max(0,min(len(text),bisect_right(offsets,offset)-1))
        fragments=[text[position(span['start']):position(span['end'])] for span in row['spans']]
        excerpt=' … '.join(fragments)
        if not remaining:omitted=True;break
        if len(excerpt)>remaining:excerpt=excerpt[:remaining];omitted=True
        selected.append((row,excerpt));remaining-=len(excerpt)
    if omitted:story.append(p('为控制报告在20页以内，本PDF展示 '+str(len(selected))+' / '+str(len(matched))+' 个匹配片段（末个片段可能节选）；其余重复证据请查看网页或下载完整JSON。省略不会改变总分。','small'))
    if not matched:story.append(p('已获取来源中未发现满足阈值的重复片段。检索范围有限，不能据此证明全文原创。'))
    for i in range(0,len(selected),16):
        refs={};chunks=[]
        for row,excerpt in selected[i:i+16]:
            chunks.append('<font size="7" color="'+MUTED+'">['+str(row['index'])+']</font> <font backColor="#FFE4B7">'+escape(clean(excerpt)).replace('\n',' ')+'</font>')
            for source in row.get('sources',[]):
                key=source.get('id') or source.get('url') or source.get('title')
                refs[source_map[key]]=True
        story.append(p(' '.join(chunks),markup=True))
        if refs:story.append(p('本组来源：'+' / '.join('<link href="#'+ref+'" color="'+TEAL+'">'+ref+'</link>' for ref in refs)+'。逐片段对应关系见网页/JSON。','small',True))
    story.append(PageBreak());story.append(p('匹配来源索引','heading'));story.append(p('以下是实际支持高亮的来源；不把仅有标题的检索候选当成重复证据。逐句标注中的范围优先用于判断证据来自摘要、网页还是PDF。','small'))
    if not source_list:story.append(p('本次没有找到满足阈值的匹配来源。检索范围有限，这不等于证明全文原创。'))
    for key,s in source_list:
        ref=source_map[key];story.append(p('<a name="'+ref+'"/>'+ref+' | '+escape(clean(s.get('title') or '来源未命名')[:180]),'sub',True))
        url=s.get('url');story.append(p(safe_link(url,url if len(url)<=100 else url[:97]+'...') if url else '用户提供的自有参考文稿，无公开网址','small',True))
        story.append(p('证据范围：'+s.get('scope','未记录'),'small'))
    story.append(p('来源获取情况','heading'))
    providers=coverage.get('providers',{})
    if providers:story.append(table([['渠道','成功请求 / 总请求','候选条目']]+[[name,str(s.get('successes',0))+' / '+str(s.get('calls',0)),str(s.get('candidates',0))] for name,s in providers.items()],[WIDTH*.42,WIDTH*.34,WIDTH*.24]))
    diagnostics=data.get('diagnostics',[]);groups=Counter((d.get('stage','未知阶段'),d.get('error','未知错误')) for d in diagnostics)
    if groups:
        story.append(p('未获取或受限记录：'+str(len(diagnostics))+' 条。下表按阶段和原因汇总，仅列出前10类原因；完整网址与查询细节保存在对应 JSON 检测记录中。','small'))
        story.append(table([['阶段','原因','次数']]+[[stage,error,str(count)] for (stage,error),count in list(groups.items())[:10]],[WIDTH*.23,WIDTH*.67,WIDTH*.1]))
    else:story.append(p('已尝试来源未记录获取错误；仍不能保证覆盖全部互联网。','small'))
    return story

def benchmark(data,title):
    cases=data['cases'];total=lambda key:sum(c.get(key,0) for c in cases)
    story=[p(title,'title'),p('合成文稿的真实联网检索验证','sub'),p('记录发布时间：'+stamp(data.get('generatedAt')),'small')]
    story.append(table([['测试组','完整命中摘录','原创被高亮'],[str(len(cases)),str(total('fullyMatchedCopies'))+'/'+str(total('copySegments')),str(total('flaggedOriginalSentences'))+'/'+str(total('originalSentences'))]],[WIDTH/3]*3))
    first=data.get('firstPass',{});story.append(p('初轮完整命中 '+str(first.get('fullyMatchedCopies',0))+'/'+str(first.get('copySegments',0))+'；修复后按各组最近一次自动测试汇总。各组复测时间不同，初轮失败记录仍保留。'))
    story.append(p('预设出处仅用于事后核对；自动检索未注入来源网址或参考全文。小样本命中比例不能当作各学科总体准确率。'))
    story.append(p('各组结果','heading'))
    story.append(table([['测试组','预设 / 实际','摘录命中','原创高亮']]+[[c['title'],str(c['expectedScore'])+'% / '+('不可判定' if c['actualScore'] is None else str(c['actualScore'])+'%'),str(c['fullyMatchedCopies'])+'/'+str(c['copySegments']),str(c['flaggedOriginalSentences'])+'/'+str(c['originalSentences'])] for c in cases],[WIDTH*.4,WIDTH*.24,WIDTH*.18,WIDTH*.18]))
    story.append(p(str(data.get('verification',{}).get('unitChecks',20))+' 项自动检查通过。TXT、DOCX、中英文文字 PDF 上传提取通过；无可提取文字 PDF、超过 10 MB 的文件按预期被拒绝。','small'))
    story.append(p('仍有一条会议正文仅部分命中，未达到预设的完整匹配；提供已知全文时能准确匹配。免费搜索验证、出版商访问限制仍影响召回，不能保证全面覆盖。'))
    story.append(PageBreak());story.append(p('证据与改进记录','heading'))
    for c in cases:
        block_start=len(story)
        story.append(p(c['title'],'sub'));story.append(p(c.get('revision','测试记录')+' | '+stamp(c.get('generatedAt')),'small'))
        for index,copy in enumerate(c.get('copyRows',[]),1):
            story.append(p('摘录 '+str(index)+' | '+str(copy.get('section','正文'))+' | 匹配 '+str(copy['matchPercentage'])+'%','small'))
            sources=copy.get('matchedSources',[])
            if not sources:story.append(p('未发现匹配来源，保持漏检记录；不把 0% 解释为原创。','small'))
            for s in sources[:3]:
                story.append(p(safe_link(s.get('url'),s.get('title') or s.get('url'))+'<br/>'+escape(clean(s.get('scope',''))),'small',True))
            if len(sources)>3:story.append(p('另有 '+str(len(sources)-3)+' 个支持来源，见对应详细检测记录。','small'))
        block=story[block_start:];del story[block_start:];story.append(KeepTogether(block))
    story.append(p('已落实的改进','heading'))
    for line in ['中英文匹配阈值按片段判断；保留 HTML/XML 段落边界。','读取公开嵌入的中文期刊正文，不执行网页脚本。','PDF 同时保留原始词形与断词归一化形式。','保留摘要、网页和 PDF 证据，逐句标明实际匹配范围及版本差异。','DNS 解析设截止时间；独立读取队列、来源缓存和有限网络重试。','检索不完整时明确提示低分或 0% 不能证明原创。']:story.append(p('- '+line,'small'))
    return story

def main():
    a=argparse.ArgumentParser();a.add_argument('--input',required=True);a.add_argument('--output',required=True);a.add_argument('--type',choices=['check','benchmark'],default='check');a.add_argument('--title',default='PaperDesk 自主查重报告');a.add_argument('--shell-evidence',action='store_true');args=a.parse_args()
    data=json.loads(Path(args.input).read_text());output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    if args.shell_evidence:
        global WIDTH
        WIDTH=540
        fonts=Path(__file__).parent/'report-shell/fonts'
        for name in ['NotoRegular','LexendSemiBold']:pdfmetrics.registerFont(TTFont(name,str(fonts/(name+'.ttf'))))
        for name,style in styles.items():style.fontName='LexendSemiBold' if name in ['title','heading'] else 'NotoRegular'
    budgets=[60000,45000,30000,20000,10000,5000,2000,500,0] if args.type=='check' else [60000]
    from pypdf import PdfReader
    for budget in budgets:
        story=report(data,args.title,budget) if args.type=='check' else benchmark(data,args.title)
        if args.shell_evidence:
            first_break=next(i for i,item in enumerate(story) if isinstance(item,PageBreak));story=story[first_break+1:]
        doc=SimpleDocTemplate(str(output),pagesize=(612,792) if args.shell_evidence else A4,rightMargin=36 if args.shell_evidence else 42,leftMargin=36 if args.shell_evidence else 42,topMargin=62,bottomMargin=48,title=args.title,author='PaperDesk',pageCompression=1,allowSplitting=1)
        if args.shell_evidence:doc.build(story)
        else:doc.build(story,onFirstPage=footer,onLaterPages=footer)
        if args.type!='check' or len(PdfReader(output).pages)+(2 if args.shell_evidence else 0)<=20:break
    else:raise ValueError('报告页数超出20页，请查看完整JSON记录')
if __name__=='__main__':main()
