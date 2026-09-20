"""Draws Subtext's home-screen icons:  python3 make-icons.py

The mark the app wears in its top bar: a frame with a caption bar under it, and
a dimmer bar above for the picture. No dependencies — the PNGs are written by
hand, so this runs anywhere. Writes icon-192.png and icon-512.png beside it.
"""
import pathlib, struct, zlib

HERE = pathlib.Path(__file__).parent

GROUND = (0x1F, 0x4F, 0xA3)      # the app's accent
INK = (0xFF, 0xFF, 0xFF)
DIM = (0x8F, 0xB2, 0xE4)         # the picture, behind the words


def rounded(rows, x0, y0, x1, y1, radius, colour, size):
    """Fills a rounded rectangle, antialiasing nothing: at 192px and up the
    corners read cleanly enough, and this keeps the file dependency-free."""
    cx0, cx1 = x0 + radius, x1 - radius
    cy0, cy1 = y0 + radius, y1 - radius
    for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
        py = y + 0.5
        if not (y0 <= py <= y1):
            continue
        for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
            px = x + 0.5
            if not (x0 <= px <= x1):
                continue
            qx = cx0 if px < cx0 else (cx1 if px > cx1 else px)
            qy = cy0 if py < cy0 else (cy1 if py > cy1 else py)
            if (px - qx) ** 2 + (py - qy) ** 2 > radius ** 2:
                continue
            rows[y][x * 3:x * 3 + 3] = bytes(colour)


def draw(size):
    rows = [bytearray(GROUND * size) for _ in range(size)]

    # The frame, inside the maskable safe circle.
    fw = size * 0.60
    fh = fw * 0.72
    fx = (size - fw) / 2
    fy = (size - fh) / 2
    stroke = max(2.0, size * 0.035)
    rounded(rows, fx, fy, fx + fw, fy + fh, size * 0.055, INK, size)
    rounded(rows, fx + stroke, fy + stroke, fx + fw - stroke, fy + fh - stroke,
            size * 0.035, GROUND, size)

    # A line of picture, then the caption line: short over long, which is the
    # shape of a two-line subtitle.
    bar_h = max(2.0, size * 0.045)
    inset = stroke + size * 0.045
    top_y = fy + fh * 0.30
    rounded(rows, fx + inset, top_y, fx + fw * 0.52, top_y + bar_h, bar_h / 2, DIM, size)
    cap_y = fy + fh - inset - bar_h
    rounded(rows, fx + inset, cap_y, fx + fw - inset, cap_y + bar_h, bar_h / 2, INK, size)
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
