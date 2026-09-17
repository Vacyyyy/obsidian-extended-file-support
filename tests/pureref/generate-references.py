"""Optional native oracle; not needed by browser tests. Writes only to a new temp directory.

python tests/pureref/generate-references.py --reader ../pur-2-file-format
Requires Python and PureRef 2.1.3 on Windows. Review/copy the generated fixtures
and PNGs into fixtures/ and references/ when intentionally updating the oracle.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--reader', type=pathlib.Path, required=True)
parser.add_argument('--pureref', default=r'C:\Program Files\PureRef\PureRef.exe')
args = parser.parse_args()
sys.path.insert(0, str(args.reader.resolve()))
from pureref2 import Scene

out = pathlib.Path(tempfile.mkdtemp(prefix='pureref-note-reference-'))
cases = [
    ('title', '.pur encoded from scratch, renderd by PureRef', dict(font_size=24)),
    ('compact', 'Images · transforms · crops · notes · groups · curves', dict(font_size=19, style='compact')),
    ('wrapped', 'A short note with enough words to wrap onto several lines.\nSecond paragraph.', dict(width=200, height=20)),
    ('rich', '<html><body style="font-family:Open Sans;font-size:22px"><p>First <b>bold</b> line</p><p style="margin-top:8px;color:#eeaa55">Second paragraph</p><ul><li>One</li><li><i>Two</i></li></ul></body></html>', dict(width=260, rich_text=True)),
]
for name, text, options in cases:
    scene = Scene()
    scene.note(text, **options)
    scene.write(out / f'{name}.pur')
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    commands = [f'load;{out / (name + ".pur")}', f'exportScene;{out / (name + ".png")};-1;-1;false;false', 'exit']
    command = [args.pureref, '-s', str(out / 'settings.ini')]
    for value in commands:
        command.extend(['-c', value])
    result = subprocess.run(command, capture_output=True, timeout=40, check=True, startupinfo=startup)
    (out / f'{name}.log').write_bytes(result.stdout + result.stderr)
print(out)
