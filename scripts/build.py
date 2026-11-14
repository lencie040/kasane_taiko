from pathlib import Path
from urllib.parse import quote
import hashlib
import json

root = Path(__file__).resolve().parents[1]
content = root / 'content'
hashes = {}


def register(path):
    url = quote(path.relative_to(root).as_posix(), safe='/')
    digest = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    hashes[url] = digest.hexdigest()
    return url


songs = [
    register(path) for path in sorted((content / 'songs').rglob('*'))
    if path.is_file() and path.suffix.lower() in ('.osz', '.zip')
]
manifest = {'songs': songs, 'hashes': hashes}
for key, path in {
    'charts': 'csv/charts.csv', 'dan': 'csv/dan.csv',
    'noise': 'noise.json', 'folders': 'folders.json',
}.items():
    if (content / path).is_file():
        manifest[key] = register(content / path)
(content / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Indexed {len(songs)} songs')
