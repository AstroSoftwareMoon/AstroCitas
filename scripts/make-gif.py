"""Monta los fotogramas (NN-duracionms.png) en un GIF optimizado."""
import sys, glob, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, '*.png')))
frames, durations = [], []
for f in files:
    im = Image.open(f).convert('RGB').resize((960, 600), Image.LANCZOS)
    frames.append(im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    durations.append(int(os.path.basename(f).split('-')[1].split('.')[0]))
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(out, os.path.getsize(out) // 1024, 'KB')
