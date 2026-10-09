import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('report',Path(__file__).with_name('pdf-report.py'));report=importlib.util.module_from_spec(spec);spec.loader.exec_module(report)
class HighlightTests(unittest.TestCase):
 def test_utf16_offsets_after_supplementary_character(self):
  text='😀 exact matching sentence';self.assertIn('>exact matching</font>',report.highlighted({'text':text,'spans':[{'start':3,'end':17}]}))
 def test_markup_in_input_is_escaped(self):
  output=report.highlighted({'text':'<script> test & text','spans':[{'start':0,'end':8}]});self.assertIn('&lt;script&gt;',output);self.assertNotIn('<script>',output);self.assertIn('&amp;',output)
if __name__=='__main__':unittest.main()
