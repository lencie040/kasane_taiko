"""Assemble a Pages site, upgrading legacy song packs in the generated output."""
import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import unicodedata
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from zipfile import ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'content'
LEGACY = {'.osz', '.zip'}


def decode(data):
    try:
        return data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return data.decode('shift_jis', errors='replace')


def norm(value):
    value = unicodedata.normalize('NFKC', str(value or '')).lower()
    return ' '.join(re.sub(r'\.(osz|zip|ktz)$', '', value).split())


def loose(value):
    punctuation = '・･·-‐－―_~〜～\'"“”‘’`!！?？、。,，.．:：;；()（）[]［］{}｛｝「」『』【】<>＜＞'
    return ''.join(ch for ch in norm(value) if not ch.isspace() and ch not in punctuation)


def archive_name(info):
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode('cp437')
    for encoding in ('utf-8', 'shift_jis'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            pass
    return raw.decode('latin-1')


def archive_path(value):
    return unicodedata.normalize('NFC', value).replace('\\', '/').removeprefix('./')


def osu_metadata(text, path):
    """Collect the playable .osu headers used to match the legacy library."""
    section = ''
    metadata, general = {}, {}
    has_notes = has_tempo = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
        elif section in ('Metadata', 'General'):
            pair = re.split(r'[:：]', line, maxsplit=1)
            if len(pair) == 2:
                (metadata if section == 'Metadata' else general)[pair[0].strip()] = pair[1].strip()
        elif section in ('TimingPoints', 'HitObjects'):
            parts = line.split(',')
            try:
                if section == 'TimingPoints':
                    has_tempo |= float(parts[1]) > 0 and (len(parts) <= 6 or parts[6].strip() == '1')
                else:
                    float(parts[2])
                    has_notes |= bool(int(parts[3]) & 11)
            except (ValueError, IndexError):
                pass
    if general.get('Mode', '0') not in ('0', '1') or not has_notes or not has_tempo:
        return None
    match = re.search(r'\[([^\]]*)\]\.osu$', path, flags=re.I)
    metadata['Version'] = metadata.get('Version') or (match.group(1).strip() if match else '') or '(無名)'
    return metadata


def shared_csv(file):
    if not file.is_file():
        return []
    lines = [line for line in decode(file.read_bytes()).splitlines() if not line.lstrip().startswith('#')]
    return list(csv.DictReader(lines))


def upgrade(source, target, rules, noise, folders, keys, native_keys, reserved_paths):
    basename = unicodedata.normalize('NFC', source.stem)
    with ZipFile(source) as original:
        files = [(archive_path(archive_name(info)), info) for info in original.infolist() if not info.is_dir()]
        charts = []
        versions = set()
        for path, info in files:
            if not path.lower().endswith('.osu'):
                continue
            metadata = osu_metadata(decode(original.read(info)), path)
            if metadata is None:
                continue
            version = metadata['Version']
            n = 2
            while norm(version) in versions:
                version = f"{metadata['Version']} ({n})"
                n += 1
            versions.add(norm(version))
            charts.append((path, metadata, version))
        if not charts:
            raise ValueError(f'{source.name}: 遊べる譜面がありません')

        def pick(field):
            return next((meta[field] for _, meta, _ in charts if meta.get(field)), '')

        title, title_u = pick('Title'), pick('TitleUnicode')
        artist, artist_u = pick('Artist'), pick('ArtistUnicode')
        display_title, display_artist = title_u or title or basename, artist_u or artist
        set_id = re.match(r'^\s*([+-]?\d+)', charts[0][1].get('BeatmapSetID', ''))
        set_id = int(set_id[1]) if set_id else 0
        if set_id > 0:
            key = f'id{set_id}'
        elif title:
            key = 'n:' + norm(f'{artist} - {title}')
        else:
            key = 'u:' + norm(f'{artist_u or artist} - {title_u or basename}')
        if set_id <= 0 and key in keys:
            key += '|' + norm(basename)
        keys.add(key)
        if key in native_keys:
            return None
        if re.search(r'\b(?:unknown|unnamed)\b', basename, re.I):
            stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', display_title).strip(' .')
            if stem:
                target = target.with_name(unicodedata.normalize('NFC', stem[:100]) + '.ktz')
        if target in reserved_paths:
            suffix = hashlib.sha256(key.encode()).hexdigest()[:8]
            target = target.with_name(f'{target.stem} [{suffix}].ktz')
        reserved_paths.add(target)
        aliases = [basename, re.sub(r'^\d+\s+', '', basename), title, title_u, display_title, key]
        aliases.extend(f'{a} - {t}' for a in (display_artist, artist) for t in (display_title, title, title_u) if a and t)
        if set_id > 0:
            aliases.append(str(set_id))
        names = {func(name) for name in aliases if name for func in (norm, loose)}

        def matches(rule):
            ref = rule.get('file', '')
            return norm(ref) == '*' or norm(ref) in names or loose(ref) in names

        applicable = [rule for rule in rules if rule.get('file') and matches(rule)]
        extras = []
        for path, _, version in charts:
            rule = next((r for r in applicable if norm(r.get('version')) == norm(version) or
                         loose(r.get('version')) and loose(r.get('version')) == loose(version)), None)
            if rule is None:
                rule = next((r for r in applicable if norm(r.get('version') or '*') == '*'), {})
            extras.append({
                'path': path, 'version': version, 'course': (rule.get('course') or '').strip(),
                'level': (rule.get('level') or '').strip(), 'noise': noise.get(key + '::' + version, {}),
            })
        membership = folders.get('assignments', {}).get(key, [])
        if isinstance(membership, str):
            membership = [membership]
        catalog = {f['id']: f for f in folders.get('folders', [])}
        included = {}
        for folder_id in membership:
            while folder_id in catalog and folder_id not in included:
                included[folder_id] = catalog[folder_id]
                folder_id = catalog[folder_id].get('parent')
        metadata = {'format': 1, 'song': {'key': key, 'title': display_title, 'artist': display_artist,
                                          'aliases': list(dict.fromkeys(v for v in aliases if v)),
                                          'folders': membership, 'folderCatalog': list(included.values())},
                    'charts': extras}
        with ZipFile(target, 'w') as converted:
            for path, info in files:
                if path.lower() != 'kasane.json':
                    converted.writestr(deterministic_entry(path, info.compress_type), original.read(info))
            converted.writestr(deterministic_entry('kasane.json'), json.dumps(metadata, ensure_ascii=False))
        return target


def deterministic_entry(name, compression=0):
    entry = ZipInfo(name)
    entry.compress_type = compression
    return entry


def build_match_catalog(output, manifest):
    packs = []
    for url in manifest['songs']:
        with ZipFile(output / unquote(url)) as pack:
            data = json.loads(pack.read('kasane.json'))
            names = {archive_path(name).lower(): name for name in pack.namelist()}
            entries = []
            for entry in data['charts']:
                path = archive_path(entry['path']).lower()
                if path in names and path.endswith('.osu'):
                    entries.append({'entry': entry, 'text': decode(pack.read(names[path]))})
            packs.append({'key': data['song']['key'], 'title': data['song']['title'],
                          'path': url, 'hash': manifest['hashes'][url], 'entries': entries})
    with (output / 'content/match-catalog.json').open('wb') as destination:
        subprocess.run(['node', str(ROOT / 'scripts/build-match-catalog.cjs')], check=True,
                       input=json.dumps(packs, ensure_ascii=False).encode('utf-8'), stdout=destination)


def build(output):
    if output == ROOT or output == CONTENT or ROOT.is_relative_to(output) or output.is_relative_to(CONTENT):
        raise ValueError('出力先はリポジトリ本体と content/ の外に指定してください')
    output.mkdir(parents=True, exist_ok=True)
    for name in ['index.html', 'difficulty.js', 'weakness.js', 'editor.js', 'editor.css', 'editor-tempo.js', 'beatmap.js',
                 'multiplayer-rules.js', 'multiplayer-peer.js', 'multiplayer-client.js', 'oni-streak.js', 'sealed-route.js']:
        shutil.copy2(ROOT / name, output / name)
    shutil.copytree(ROOT / 'vendor', output / 'vendor', dirs_exist_ok=True)
    assets = output / 'content'
    assets.mkdir(exist_ok=True)
    for name in ['fonts', 'characters']:
        if (CONTENT / name).is_dir():
            shutil.copytree(CONTENT / name, assets / name, dirs_exist_ok=True)
    for name in ['folders.json', 'characters.csv']:
        if (CONTENT / name).is_file():
            shutil.copy2(CONTENT / name, assets / name)

    rules = shared_csv(CONTENT / 'csv/charts.csv')
    noise_path = CONTENT / 'noise.json'
    noise = json.loads(noise_path.read_text(encoding='utf-8')) if noise_path.is_file() else {}
    folders_path = CONTENT / 'folders.json'
    folders = json.loads(folders_path.read_text(encoding='utf-8')) if folders_path.is_file() else {}
    songs, keys, hashes = [], set(), {}
    sources = [p for p in sorted((CONTENT / 'songs').rglob('*'))
               if p.is_file() and p.suffix.lower() in LEGACY | {'.ktz'}]
    native = [p for p in sources if p.suffix.lower() == '.ktz']
    native_keys = set()
    for path in native:
        with ZipFile(path) as pack:
            info = json.loads(pack.read('kasane.json'))
            if info.get('format') != 1 or not info['song'].get('key') or not info['song'].get('title'):
                raise ValueError(f'{path.name}: .ktz の曲情報を読めません')
            key = info['song']['key']
            if key in native_keys:
                raise ValueError(f'{path.name}: 同じ曲IDの .ktz が複数あります')
            native_keys.add(key)
    reserved_paths = {output / path.relative_to(ROOT).with_suffix('.ktz') for path in native}
    count = 0

    def register(path):
        url = quote(path.relative_to(output).as_posix(), safe='/')
        digest = hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
        with path.open('rb') as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b''):
                digest.update(chunk)
        hashes[url] = digest.hexdigest()
        return url

    for source in sources:
        relative = source.relative_to(ROOT)
        target = output / relative.with_suffix('.ktz')
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix.lower() == '.ktz':
            shutil.copy2(source, target)
        else:
            target = upgrade(source, target, rules, noise, folders, keys, native_keys, reserved_paths)
            if target is None:
                continue
            count += 1
        songs.append(register(target))

    manual = assets / 'dans.json'
    if (CONTENT / 'dans.json').is_file():
        shutil.copy2(CONTENT / 'dans.json', manual)
    else:
        dan_rows = shared_csv(CONTENT / 'csv/dan.csv')
        if dan_rows:
            conditions = ('gauge','good','ok','bad','tokuryo','roll','combo','score','hits')
            dans = []
            for i, row in enumerate(dan_rows, 2):
                refs = [{'file': row.get(f'song{j}', ''), 'version': row.get(f'diff{j}', '')} for j in (1,2,3)]
                if any(ref['file'] for ref in refs):
                    dans.append({'id': row.get('id') or f'L{i}', 'name': row.get('name', ''), 'refs': refs,
                                 'conditions': {k: row[k] for k in conditions if row.get(k)}})
            manual.write_text(json.dumps({'format': 1, 'dans': dans}, ensure_ascii=False, indent=2), encoding='utf-8')
    manifest = {'format': 1, 'songs': songs, 'hashes': hashes, 'converted': count}
    for key, name in [('dan', 'dans.json'), ('folders', 'folders.json'), ('characters', 'characters.csv')]:
        if (assets / name).is_file():
            manifest[key] = register(assets / name)
    (assets / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    build_match_catalog(output, manifest)
    endpoint = os.environ.get('MATCH_ENDPOINT', '').strip()
    if endpoint:
        parsed = urlsplit(endpoint)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.fragment:
            raise ValueError('MATCH_ENDPOINT には HTTPS の対戦 API URL を指定してください')
    (output / 'match-config.js').write_text(
        'globalThis.KASANE_MATCH_ENDPOINT = ' + json.dumps(endpoint) + ';\n', encoding='utf-8')
    print(f'Indexed {len(songs)} .ktz packs ({count} converted from legacy archives)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.site')
    build(parser.parse_args().output.resolve())
