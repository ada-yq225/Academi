"""Validate a downloaded report against a known submission and original input.

This checks content consistency, not a cryptographic Turnitin signature. The
submission identifier must come from the authenticated submission workflow.
"""
import argparse
import hashlib
import json
import re
import unicodedata
import difflib
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

from pypdf import PdfReader


def normalized(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def input_text(path):
    if path.suffix.lower() == '.txt':
        return path.read_text(encoding='utf-8')
    if path.suffix.lower() == '.pdf':
        return '\n'.join(page.extract_text() or '' for page in PdfReader(path).pages)
    if path.suffix.lower() == '.docx':
        with ZipFile(path) as archive:
            xml = ElementTree.fromstring(archive.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        visible = []
        for paragraph in xml.findall('.//w:p', ns):
            # Word field instructions (TOC/PAGEREF) are not printed. Only w:t
            # contains visible text; a TOC page number can change on import.
            text = ''.join(node.text or '' for node in paragraph.findall('.//w:t', ns))
            instruction = ''.join(node.text or '' for node in paragraph.findall('.//w:instrText', ns))
            if 'PAGEREF' in instruction:
                text = re.sub(r'\s*\d+\s*$', '', text)
            visible.append(text)
        return '\n'.join(visible)
    raise ValueError('Only PDF, DOCX and UTF-8 TXT inputs are supported')


def validate(report_path, original_path, submission_id, expected_score):
    report_path, original_path = Path(report_path), Path(original_path)
    report_bytes, original_bytes = report_path.read_bytes(), original_path.read_bytes()
    if not report_bytes.startswith(b'%PDF-'):
        raise ValueError('Downloaded file is not a PDF')
    if report_bytes == original_bytes:
        raise ValueError('Downloaded file is the original submission, not a report')
    reader = PdfReader(report_path)
    if reader.is_encrypted or len(reader.pages) < 2:
        raise ValueError('Report is encrypted or has no separate report summary')
    pages = [p.extract_text() or '' for p in reader.pages]
    cover = normalized(pages[0])
    if not re.fullmatch(r'trn:oid:::\d+:\d+', submission_id):
        raise ValueError('Expected report submission ID is invalid')
    if submission_id not in cover:
        raise ValueError('Report submission ID does not match the confirmed submission')
    scores = re.findall(r'(\d+(?:\.\d+)?)\s*%\s*(?:Overall\s+Similarity|Similaridade\s+geral)', '\n'.join(pages[:3]), re.I)
    if len(scores) != 1 or not 0 <= float(scores[0]) <= 100:
        raise ValueError('Report must contain exactly one valid Overall Similarity score')
    score = float(scores[0])
    if score != expected_score:
        raise ValueError('PDF score does not match the official inbox score')
    source = normalized(input_text(original_path))
    if original_path.suffix.lower() == '.pdf':
        # A submitted PDF can itself be an older Turnitin report. Its repeated
        # page and submission-ID rails are metadata, not manuscript text;
        # Turnitin drops them when it renders the new report.
        old_id = r'(?:SubmissionID|IDdeentrega)trn:oid:::\d+:\d+'
        if re.search(old_id, source):
            source = re.sub(old_id, '', source)
            source = re.sub(r'Page\d+of\d+[-–](?:Integrity)?Submission', '', source)
    if len(source) < 200:
        raise ValueError('Not enough readable source text for automatic matching')
    # Match only submission pages. Remove the known report rails, never source
    # words. Match markers and repeated table headings are the only permitted
    # additions. Missing/replaced/reordered source characters fail closed.
    rail = r'(?:Page \d+ of \d+ [-–] (?:Integrity )?Submission|Página \d+ de \d+ [-–] Envio de integridade)'
    body_pages = [p for p in pages if re.search(rail, p)]
    if not body_pages:
        raise ValueError('Cannot identify official submission pages')
    clean = []
    for page in body_pages:
        # Turnitin renders Word's dynamic TOC leaders/page references and the
        # original document's footer page number. Compare the actual text.
        if original_path.suffix.lower() == '.docx':
            page = re.sub(r'(?m)^\s*\d{1,3}\s*\n(?=' + rail + r')', '', page)
            # Some Word footer fields are rendered by Turnitin as the same
            # page number on several consecutive lines before its own rail.
            page = re.sub(r'(?m)^([0-9]{1,3})[ \t]*\n(?:\1[ \t]*\n){2,}(?=' + rail + r')', '', page)
            # Word list bullets are generated from numbering metadata and do
            # not occur in the document.xml visible-text runs.
            page = re.sub(r'(?m)^[ \t]*[–•][ \t]+', '', page)
            page = re.sub(r'(?m)^([^\n]*?)\s+\.{3,}\s+\d+\s*$', r'\1', page)
        page = re.sub(rail + r'[^\n]*', '', page)
        page = re.sub(r'(?:Submission ID|ID de entrega)\s*trn:oid:::\d+:\d+', '', page)
        clean.append(page)
    body = normalized('\n'.join(clean))
    added = 0
    if len(source) > 200000 or len(body) > 250000:
        # Character-level SequenceMatcher can take quadratic time on long
        # papers. Walk forward with a short exact anchor instead; still reject
        # missing or replaced source text and only permit the same small
        # insertions as the short-document path.
        if len(source) > 2000000 or len(body) > 2500000:
            raise ValueError('Text too large for automatic matching; manual review required')
        i = j = 0
        while i < len(source) and j < len(body):
            if source[i] == body[j]:
                i += 1
                j += 1
                continue
            anchor = source[i:i + 32]
            k = body.find(anchor, j + 1, j + 201)
            if k < 0:
                raise ValueError('Report body differs from original input; manual review required')
            extra = body[j:k]
            heading = extra.lstrip('0123456789')
            if heading and (len(heading) > 160 or heading not in source):
                raise ValueError('Report body differs from original input; manual review required')
            added += len(extra)
            j = k
        if i != len(source) or j != len(body):
            raise ValueError('Report body differs from original input; manual review required')
    else:
        matcher = difflib.SequenceMatcher(None, source, body, autojunk=False)
        for tag, i, j, k, l in matcher.get_opcodes():
            if tag == 'equal':
                continue
            extra = body[k:l]
            heading = extra.lstrip('0123456789')
            if tag != 'insert' or (heading and (len(heading) > 160 or heading not in source)):
                raise ValueError('Report body differs from original input; manual review required')
            added += len(extra)
    if added > max(100, len(source) * .05):
        raise ValueError('Too many inserted characters; manual review required')
    return {
        'provider': 'Turnitin', 'reportType': 'similarity',
        'submissionId': submission_id, 'similarityScore': score,
        'pages': len(pages), 'inputSha256': hashlib.sha256(original_bytes).hexdigest(),
        'reportSha256': hashlib.sha256(report_bytes).hexdigest(),
        'inputTextMatched': True, 'validation': 'content-consistency',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--submission-id', required=True)
    parser.add_argument('--score', required=True, type=float)
    parser.add_argument('--audit', required=True, type=Path)
    args = parser.parse_args()
    result = validate(args.report, args.input, args.submission_id, args.score)
    args.audit.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
