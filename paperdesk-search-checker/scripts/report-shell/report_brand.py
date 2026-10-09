"""Header image with source attribution supplied by the report layout."""
from pathlib import Path
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageChops
LOGO=Path(__file__).with_name('report-header-logo.png')
def draw_brand(c,w,h):
    # Clip the image's white margins in the PDF viewport, without editing PNG bytes.
    with Image.open(LOGO) as image:
        rgb=image.convert('RGB')
        bounds=ImageChops.difference(rgb,Image.new('RGB',rgb.size,'white')).getbbox()
        if not bounds:raise ValueError('Header logo has no visible content')
        left,top,right,bottom=bounds
        scale=110/(right-left);height=(bottom-top)*scale
        x,y=36,h-49
        c.saveState()
        clip=c.beginPath();clip.rect(x,y,110,height);c.clipPath(clip,stroke=0,fill=0)
        c.drawImage(ImageReader(rgb),x-left*scale,y-(rgb.height-bottom)*scale,width=rgb.width*scale,height=rgb.height*scale)
        c.restoreState()
