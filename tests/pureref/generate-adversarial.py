"""Optional fixture authoring: Python 3.11+, no PureRef or third-party packages.

python tests/pureref/generate-adversarial.py --reader ../pur-2-file-format --out NEW_DIRECTORY
Review output before copying into fixtures/. Never changes the sibling checkout.
"""
import argparse
import pathlib
import sys
import struct
import zlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--reader', type=pathlib.Path, required=True)
parser.add_argument('--out', type=pathlib.Path, required=True)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=False)
sys.path.insert(0, str(args.reader.resolve()))
from pureref2 import Scene, transform


def png(seed=0):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = b''.join(b'\0' + b''.join(bytes((255 if x < 16 else 30, (y * 8 + seed) % 256, 60))
                                     for x in range(32)) for y in range(32))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 32, 32, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


def save(name, scene):
    scene.write(args.out / f'adv-{name}.pur')
    scene.connection.close()


s = Scene()
g = s.group(name='Translated outer group', x=-450, y=120)
h = s.group(name='Rotated inner group', parent=g, x=150, y=-80)
s.connection.execute('UPDATE items SET transform=? WHERE id=?', (transform(150, -80, rotation=37), h))
for i, (sx, sy, angle) in enumerate([(-3, 2, 0), (2, .3, 73), (.02, 4, -25)]):
    s.image_data(png(), 32, 32, parent=h, x=i*170, y=i*70, scale_x=sx, scale_y=sy,
                 rotation=angle, clip=(3, 5, 21, 19), name=f'Mirror/skew crop {i}')
s.drawing([[(0, -100, 0), (2, 400, -700), (3, -400, 700), (3, 150, 10)]], parent=g, width=3)
s.note('Cropped, mirrored, nested. Three images and one curve.', y=-200)
save('geometry', s)

s = Scene()
for i, text in enumerate(['Arabic العربية / Hebrew עברית / 日本語 / Ω / 👩🏽‍💻',
                          'Combining: e\u0301 A\u030a Z\u0351\u0357\u0343 / zero\u200bwidth',
                          'unbreakable_' * 50, 'Line\n' * 35]):
    s.note(text, x=(i % 2)*500, y=(i // 2)*850, width=220, height=12,
           style='compact' if i % 2 else 'comfortable')
save('typography', s)

s = Scene()
s.note('SAFE SENTINEL', y=-170)
s.note('''<p onclick="window.purerefPwned=1">VISIBLE SAFE TEXT <b>bold</b></p>
<script>window.purerefPwned=1</script><img src="https://example.invalid/image" onerror="window.purerefPwned=1">
<iframe src="https://example.invalid/frame"></iframe><object data="https://example.invalid/object"></object>
<video poster="https://example.invalid/poster"><source src="https://example.invalid/movie"></video>
<svg><foreignObject><img src="https://example.invalid/nested"></foreignObject></svg>
<style>@import url(https://example.invalid/style);body{display:none}</style>
<a href="javascript:window.purerefPwned=1">plain link text</a>
<span style="position:fixed;inset:0;background:url(https://example.invalid/css);font-size:999999px">bounded text</span>
<form action="https://example.invalid/form"><input autofocus><button>submit</button></form>''',
       rich_text=True, width=340)
save('hostile-note', s)

s = Scene()
s.note('SURVIVOR: damaged siblings must not hide me', y=-150)
a = s.group(name='Cycle A'); b = s.group(name='Cycle B', parent=a)
s.connection.execute('UPDATE items SET parent=? WHERE id=?', (b, a))
s.note('ORPHAN MUST BE OMITTED', parent=987654)
parent = -1
for i in range(132):
    parent = s.group(name=f'Depth {i}', parent=parent)
s.note('TOO DEEP MUST BE OMITTED', parent=parent)
bad = s.image_data(png(), 32, 32)
s.connection.execute('UPDATE items SET transform=? WHERE id=?', (b'broken Qt variant', bad))
save('graph', s)

s = Scene()
s.note('SURVIVOR: only the green/red square is supported', y=-150)
s.image_data(png(), 32, 32, scale_x=3, scale_y=3)
s.image_data(png(1), 32, 32, x=150)
s.connection.execute('UPDATE images SET source_type=2, source=? WHERE id=1', ('https://example.invalid/linked.png',))
s.image_data(png(2), 8001, 8000, x=300)
s.image_data(b'not a supported image', 32, 32, x=450)
missing = s.image_data(png(), 32, 32, x=600)
s.connection.execute('UPDATE items_images SET image=999999 WHERE id=?', (missing,))
save('resources', s)

s = Scene()
for i in range(400):
    s.image_data(png(), 32, 32, x=(i % 25)*40, y=(i // 25)*40, rotation=(i % 4)*90)
save('shared-400', s)

s = Scene()
for i in range(10001):
    s.group(name=f'Over limit {i}')
save('item-limit', s)

s = Scene()
s.note('Unsupported schema must fail visibly')
s.connection.execute('PRAGMA user_version=999999')
save('schema', s)
(args.out / 'adv-truncated.pur').write_bytes((args.out / 'adv-geometry.pur').read_bytes()[:91])
print(f'Wrote adversarial fixtures to {args.out.resolve()}')
