"""Record AI eligibility before submitting to the similarity provider."""
import json
import re
import sys
import unicodedata
from pathlib import Path

from validate_official_report import input_text

text = input_text(Path(sys.argv[1]))
count = len(re.findall(r'\b\w+\b', text))
han = sum('\u3400' <= char <= '\u9fff' for char in text)
letters = sum(unicodedata.category(char).startswith('L') for char in text)
chinese = han >= 100 and han / max(letters, 1) >= .2
reason = 'chinese' if chinese else 'word-minimum' if count < 350 else 'word-limit' if count > 29500 else 'eligible'
Path(sys.argv[2]).write_text(json.dumps({
    'wordCount': count, 'hanCount': han, 'letterCount': letters,
    'aiEligible': reason == 'eligible', 'reason': reason,
}) + '\n')
print(f'AI preflight: words={count}, Chinese share={han/max(letters,1):.2f}, route={reason}')
