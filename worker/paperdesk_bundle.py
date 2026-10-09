"""Bundle the separately attributed AI and independent similarity reports."""
import sys
from pathlib import Path
from pypdf import PdfReader,PdfWriter
root=Path(sys.argv[1]);writer=PdfWriter()
for name in ['ai-restyled.pdf','similarity-restyled.pdf']:
    reader=PdfReader(root/name)
    for page in reader.pages:writer.add_page(page)
writer.add_metadata({'/Title':'PaperDesk similarity + ACADEMI.CX AI results','/Author':'PaperDesk'})
with (root/'restyled.pdf').open('wb') as stream:writer.write(stream)
