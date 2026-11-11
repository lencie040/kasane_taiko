from pathlib import Path
import json
from urllib.parse import quote
root=Path(__file__).resolve().parents[1]
def url(p): return quote(p.relative_to(root).as_posix())
manifest={'songs':[url(p) for p in sorted((root/'content/songs').rglob('*')) if p.suffix.lower() in ('.osz','.zip')]}
for kind in ('charts','dan'):
 p=root/'content/csv'/f'{kind}.csv'
 if p.exists():manifest[kind]=url(p)
p=root/'content/noise.json'
if p.exists():manifest['noise']=url(p)
(root/'content/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(f"Indexed {len(manifest['songs'])} songs")
