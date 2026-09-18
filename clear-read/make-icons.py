"""Draws Clear Read's home-screen icons:  python3 make-icons.py

Thirteen bars — one per active electrode, the same mark the app wears in its
top bar. No dependencies: the PNGs are written by hand so this runs anywhere.
Writes icon-192.png and icon-512.png next to this file.
"""
import pathlib, struct, zlib

HERE = pathlib.Path(__file__).parent

GROUND = (0x0A, 0x6F, 0x5E)   # the app's accent
BAR = (0xFF, 0xFF, 0xFF)
# Relative bar heights, tallest = 1.0. A speech envelope, not a decoration:
# thirteen channels, unevenly loaded, which is what the map actually looks like.
HEIGHTS = [4, 7, 10, 13, 9, 6, 11, 14, 8, 5, 9, 12, 6]


def draw(size):
    rows = [bytearray(GROUND * size) for _ in range(size)]

    span = size * 0.58                      # inside the maskable safe circle
    n = len(HEIGHTS)
    bar_w = span / (n + (n - 1) * 0.6)
    gap = bar_w * 0.6
    left = (size - span) / 2.0
    baseline = size / 2.0 + size * 0.23
    tallest = size * 0.46
    radius = bar_w / 2.0

    for i, h in enumerate(HEIGHTS):
        x0 = left + i * (bar_w + gap)
        x1 = x0 + bar_w
        bar_h = max(bar_w, tallest * h / max(HEIGHTS))
        y0 = baseline - bar_h
        y1 = baseline
        cx0, cx1 = x0 + radius, x1 - radius
        cy0, cy1 = y0 + radius, y1 - radius
        for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
            py = y + 0.5
            for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
                px = x + 0.5
                if not (x0 <= px <= x1 and y0 <= py <= y1):
                    continue
                # rounded caps top and bottom
                qy = cy0 if py < cy0 else (cy1 if py > cy1 else py)
                qx = cx0 if px < cx0 else (cx1 if px > cx1 else px)
                if (px - qx) ** 2 + (py - qy) ** 2 > radius ** 2:
                    continue
                rows[y][x * 3:x * 3 + 3] = bytes(BAR)
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    path.write_bytes(png)


for size in (192, 512):
    out = HERE / f'icon-{size}.png'
    write_png(out, size, draw(size))
    print(f'{out.name}  {out.stat().st_size:,} bytes')
