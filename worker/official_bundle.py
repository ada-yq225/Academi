"""Deliver original Turnitin similarity plus clearly attributed ACADEMI.CX AI."""
import io, json, re, shutil, sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from validate_official_report import validate

root, original = Path(sys.argv[1]), Path(sys.argv[2])
manifest = json.loads((root / 'official-return.json').read_text())
audit = validate(root / 'similarity-report.pdf', original, manifest['submissionId'], manifest['similarityScore'])
ai = PdfReader(root / 'ai-report.pdf')
match = re.search(r'(\d+(?:\.\d+)?)%\s*detected as AI', ai.pages[0].extract_text() or '', re.I)
if not match or not 0 <= float(match[1]) <= 100:
    raise ValueError('AI score is missing or invalid')

def cover(title, lines):
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(612,792))
    c.setFillColorRGB(.04,.22,.28)
    c.setFont('Helvetica-Bold',25); c.drawString(44,724,'PaperDesk')
    c.setFont('Helvetica-Bold',18); c.drawString(44,677,title)
    c.setFont('Helvetica',11)
    for n,line in enumerate(lines): c.drawString(44,633-n*25,line)
    c.setFont('Helvetica',9)
    c.drawString(44,50,'Provider attribution is separate for AI and similarity. Original pages follow.')
    c.save();stream.seek(0)
    return PdfReader(stream).pages[0]

ai_out = PdfWriter()
ai_out.add_page(cover('AI Writing Report',[
    'Source: ACADEMI.CX (its own AI model)',
    f'AI indicator: {float(match[1]):g}%',
    'This AI result is not a Turnitin AI assessment.',
    'PaperDesk adds this source cover; the original AI report pages follow.',
]))
for page in ai.pages: ai_out.add_page(page)
with (root/'ai-restyled.pdf').open('wb') as f: ai_out.write(f)
# Preserve the official PDF bytes, signature fields and original attribution.
shutil.copyfile(root/'similarity-report.pdf',root/'similarity-restyled.pdf')
combined=PdfWriter()
combined.add_page(cover('Combined Results - Separate Providers',[
    f'AI: {float(match[1]):g}% - ACADEMI.CX',
    f'Similarity: {manifest["similarityScore"]:g}% - Turnitin',
    'The combined file is assembled by PaperDesk.',
    'It is not a Turnitin-issued combined AI and similarity report.',
    'The separate similarity download is the unmodified official PDF.',
]))
for filename in ['ai-restyled.pdf','similarity-report.pdf']:
    for page in PdfReader(root/filename).pages: combined.add_page(page)
with (root/'restyled.pdf').open('wb') as f: combined.write(f)
scores={'aiScore':float(match[1]),'similarityScore':manifest['similarityScore'],'layoutVersion':3,
        'sources':{'ai':'ACADEMI.CX','similarity':'Turnitin','submissionId':manifest['submissionId']}}
(root/'scores.json').write_text(json.dumps(scores))
(root/'official-audit.json').write_text(json.dumps(audit,indent=2))
print(json.dumps(scores))
