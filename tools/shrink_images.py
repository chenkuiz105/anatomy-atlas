#!/usr/bin/env python3
"""Downscale note images in place (max 1600px wide, JPEG q82 / optimized PNG) to keep the site light."""
import os, sys
from PIL import Image
root = sys.argv[1]
before = after = 0
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.join(d, f)
        ext = f.lower().rsplit('.', 1)[-1]
        if ext not in ('jpg', 'jpeg', 'png'):
            continue
        size = os.path.getsize(p); before += size
        im = Image.open(p)
        if im.width > 1600:
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        if ext in ('jpg', 'jpeg'):
            im.convert('RGB').save(p, 'JPEG', quality=82, optimize=True, progressive=True)
        else:
            im.save(p, 'PNG', optimize=True)
        after += os.path.getsize(p)
print(f'{before/1e6:.1f} MB -> {after/1e6:.1f} MB')
