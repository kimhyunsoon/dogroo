#!/usr/bin/env python3
# do 시리즈 PWA 아이콘 합성기: 마크 SVG 하나 + 배경색 -> icon.svg, icon-maskable.svg
# 규칙: 512 캔버스, 단색 배경, 마크만 중앙 배치(글자 없음)
#   일반 아이콘   = 마크 외곽을 300x300 상자에 맞춤
#   마스커블 아이콘 = 230x230 상자에 맞춤 (중앙 80% 안전 원 안)
# 사용법: python3 compose-icons.py <mark.svg> <배경색> <출력폴더>
import re, subprocess, sys, io
from PIL import Image

CANVAS, BOX_ICON, BOX_MASKABLE = 512, 300, 230

mark_path, bg, out = sys.argv[1:4]
src = open(mark_path).read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', src).group(1).split()]
inner = re.search(r'<svg[^>]*>(.*)</svg>', src, re.S).group(1)

# 마크의 실제 외곽(투명 아닌 영역)을 viewBox 단위로 구한다
RW = 2000
png = subprocess.run(['rsvg-convert', '-w', str(RW), mark_path], capture_output=True, check=True).stdout
im = Image.open(io.BytesIO(png))
x1, y1, x2, y2 = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
k = vb[2] / im.width
bx, by, bw, bh = vb[0] + x1 * k, vb[1] + y1 * k, (x2 - x1) * k, (y2 - y1) * k


def icon(box):
    s = box / max(bw, bh)
    w, h = bw * s, bh * s
    x, y = (CANVAS - w) / 2, (CANVAS - h) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">'
            f'<rect width="{CANVAS}" height="{CANVAS}" fill="{bg}"/>'
            f'<svg x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" viewBox="{bx:.2f} {by:.2f} {bw:.2f} {bh:.2f}">{inner}</svg>'
            '</svg>\n')


open(f'{out}/icon.svg', 'w').write(icon(BOX_ICON))
open(f'{out}/icon-maskable.svg', 'w').write(icon(BOX_MASKABLE))
