"""Draws Tribelands' home-screen icons:  python3 make-icons.py

One low-poly island tile, a snow-capped mountain and a tree standing on it —
the same shapes the map is drawn with. No dependencies: the PNGs are written
by hand so this runs anywhere. Writes icon-192.png and icon-512.png beside it.
"""
import pathlib, struct, zlib

HERE = pathlib.Path(__file__).parent
SEA = (0x1F, 0x5F, 0x9E)

# Shapes in a 0..1 square, back to front: (colour, [points]).
SHAPES = [
    ((0x2A, 0x6F, 0xB0), [(.5, .30), (.92, .52), (.5, .74), (.08, .52)]),          # shallows
    ((0x6E, 0x55, 0x3C), [(.16, .52), (.5, .69), (.5, .76), (.16, .59)]),          # tile edge, left
    ((0x55, 0x40, 0x2C), [(.5, .69), (.84, .52), (.84, .59), (.5, .76)]),          # tile edge, right
    ((0x9C, 0xC7, 0x5E), [(.5, .35), (.84, .52), (.5, .69), (.16, .52)]),          # grass
    ((0xAE, 0xD4, 0x72), [(.5, .35), (.5, .69), (.16, .52)]),                       # lit facet
    ((0xB9, 0xB7, 0xAD), [(.24, .56), (.47, .62), (.43, .20)]),                    # mountain, lit
    ((0x86, 0x85, 0x7D), [(.47, .62), (.64, .55), (.43, .20)]),                    # mountain, shade
    ((0xF6, 0xF7, 0xF9), [(.43, .20), (.355, .34), (.405, .37), (.445, .335)]),    # snow
    ((0xD9, 0xDE, 0xE5), [(.43, .20), (.445, .335), (.50, .35)]),
    ((0x6B, 0x4A, 0x30), [(.66, .60), (.69, .60), (.69, .52), (.66, .52)]),        # trunk
    ((0x3F, 0x8A, 0x45), [(.585, .54), (.675, .545), (.675, .36)]),                # tree, lit
    ((0x2C, 0x6A, 0x36), [(.675, .545), (.765, .54), (.675, .36)]),                # tree, shade
    ((0xE7, 0xB2, 0x3A), [(.43, .20), (.43, .10), (.52, .13), (.43, .16)]),        # flag
]


def inside(px, py, pts):
    hit = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]; xj, yj = pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def draw(size):
    rows = [bytearray(SEA * size) for _ in range(size)]
    ss = 3                                     # supersample for smooth edges
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    px = (x + (sx + .5) / ss) / size
                    py = (y + (sy + .5) / ss) / size + .03
                    col = SEA
                    for c, pts in SHAPES:
                        if inside(px, py, pts):
                            col = c
                    for k in range(3):
                        acc[k] += col[k]
            rows[y][x * 3:x * 3 + 3] = bytes(v // (ss * ss) for v in acc)
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.write_bytes(png)


for s in (192, 512):
    write_png(HERE / f'icon-{s}.png', s, draw(s))
    print(f'icon-{s}.png')
