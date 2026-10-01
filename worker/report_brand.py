from pathlib import Path

def draw_brand(c, width, height):
    c.drawImage(str(Path(__file__).with_name('report-logo.png')), 36, height - 43, width=65.3, height=20, mask='auto')
    c.setFont('NotoRegular', 7)
    c.setFillColorRGB(.18, .18, .18)
    c.drawString(112, height - 27, 'Source: ACADEMI.CX | Non-official report')
    c.setFont('NotoRegular', 6)
    c.drawString(112, height - 38, 'Not issued or certified by Turnitin')
