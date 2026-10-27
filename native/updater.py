"""Opt-in native host. Not bootstrapped/installed by this source distribution."""
from __future__ import annotations
import base64, contextlib, hashlib, io, json, os, re, shutil, stat, struct, sys, time, urllib.request, urllib.parse, zipfile
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

REPO = 'crevice0308/Search-Clean'
HOST = 'com.searchclean.updater'
# Deliberately empty: reviewed bootstrap must pin publisher key and each browser ID.
PUBLIC_KEY = b''
EXTENSION_IDS: tuple[str, ...] = ()
ROOT = Path(__file__).resolve().parent / 'managed'
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_EXPANDED = 24 * 1024 * 1024
ASSET = 'Search-Clean-extension.zip'
META_URL = f'https://github.com/{REPO}/releases/latest/download/update.json'

class Rejected(Exception):
    pass

def reject(condition, code):
    if condition:
        raise Rejected(code)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')

def version(value):
    reject(not isinstance(value, str) or not re.fullmatch(r'(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){2,3}', value), 'version')
    parts = tuple(map(int, value.split('.')))
    reject(any(p > 65535 for p in parts), 'version')
    return parts + (0,) * (4-len(parts))

def safe_url(url):
    p = urllib.parse.urlsplit(url)
    reject(p.scheme != 'https' or p.username is not None or p.password is not None or p.port not in (None,443) or p.fragment or p.hostname not in ('github.com', 'release-assets.githubusercontent.com'), 'download_origin')
    if p.hostname == 'github.com':
        reject(not p.path.startswith('/'+REPO+'/releases/'), 'download_repository')
    return url

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, safe_url(newurl))

def download(url, limit):
    opener = urllib.request.build_opener(Redirect())
    with opener.open(urllib.request.Request(safe_url(url), headers={'User-Agent':'SearchClean-Updater/1','Accept-Encoding':'identity'}), timeout=20) as response:
        safe_url(response.url)
        reject(response.headers.get('Content-Encoding', 'identity') != 'identity', 'encoding')
        deadline = time.monotonic() + 60
        chunks, count = [], 0
        while True:
            reject(time.monotonic() > deadline, 'download_timeout')
            chunk = response.read1(min(65536, limit + 1 - count))
            reject(time.monotonic() > deadline, 'download_timeout')
            if not chunk: break
            chunks.append(chunk); count += len(chunk)
            reject(count > limit, 'download_size')
        return b''.join(chunks)

def metadata(raw, public_key, now):
    reject(len(raw)>16384 or len(public_key)!=32, 'trust_not_configured')
    try:
        envelope = json.loads(raw)
        reject(set(envelope) != {'signed','signature'}, 'metadata')
        value = envelope['signed']
        Ed25519PublicKey.from_public_bytes(public_key).verify(base64.b64decode(envelope['signature'], validate=True), canonical(value))
        reject(set(value) != {'schema','repo','channel','sequence','version','tag','asset','size','sha256','expires'}, 'metadata')
        reject(value['schema'] != 1 or value['repo'] != REPO or value['channel'] != 'stable' or value['asset'] != ASSET, 'metadata_target')
        reject(type(value['sequence']) is not int or value['sequence'] < 1 or type(value['size']) is not int or not 0 < value['size'] <= MAX_ARCHIVE, 'metadata_bounds')
        reject(type(value['expires']) is not int or not now < value['expires'] <= now+31*86400, 'expired')
        version(value['version'])
        reject(value['tag'] != 'v'+value['version'] or not re.fullmatch('[a-f0-9]{64}',value['sha256']), 'metadata_asset')
        return value
    except Rejected:
        raise
    except Exception as exc:
        raise Rejected('signature_or_metadata') from exc

def no_links(root):
    for path in [root, *root.parents]:
        if path.exists():
            reject(path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400), 'filesystem_link')
    if root.exists():
        for path in root.rglob('*'):
            reject(path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400), 'filesystem_link')

def unpack(data, destination, expected):
    seen, total = set(), 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        reject(len(archive.infolist())>256, 'archive_count')
        for info in archive.infolist():
            name = info.filename
            parts = name.split('/')
            reject(info.is_dir() or len(parts)<2 or parts[0]!='extension' or any(not re.fullmatch(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*',p) for p in parts), 'archive_path')
            reject(any(p.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(10)],*[f'LPT{i}' for i in range(10)]} for p in parts), 'archive_path')
            mode = info.external_attr >> 16
            reject(stat.S_IFMT(mode) not in (0, stat.S_IFREG) or info.flag_bits & 1, 'archive_type')
            key = name.casefold()
            reject(key in seen, 'archive_duplicate'); seen.add(key)
            total += info.file_size
            reject(total>MAX_EXPANDED or info.file_size>MAX_ARCHIVE, 'archive_size')
            out = destination.joinpath(*parts[1:]); out.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(info) as source, out.open('xb') as target:
                shutil.copyfileobj(source,target,65536)
    manifest = json.loads((destination/'manifest.json').read_text('utf-8'))
    reject(manifest.get('version') != expected or manifest.get('manifest_version') != 3 or manifest.get('name') != 'Search Clean Lite', 'archive_manifest')
    reject(not {'manifest.json','content.js','content.css','popup.html','updater.js'}.issubset({p.name for p in destination.iterdir()}), 'archive_missing')

def compatible(old, new, directory):
    # Capability or identity changes require explicit manual bootstrap, not auto-update.
    fields = ('manifest_version','name','key','permissions','optional_permissions',
              'host_permissions','optional_host_permissions','content_scripts',
              'background','externally_connectable','web_accessible_resources',
              'content_security_policy','minimum_chrome_version','action','icons')
    reject(any(old.get(k) != new.get(k) for k in fields), 'incompatible_manifest')
    paths = []
    paths.extend(new.get('icons', {}).values())
    action = new.get('action', {})
    if 'default_popup' in action: paths.append(action['default_popup'])
    icons = action.get('default_icon', {})
    paths.extend(icons.values() if isinstance(icons, dict) else [icons])
    worker = new.get('background', {}).get('service_worker')
    reject(not worker, 'incompatible_manifest'); paths.append(worker)
    for script in new.get('content_scripts', []):
        paths.extend(script.get('js', [])); paths.extend(script.get('css', []))
    for name in paths:
        reject(not isinstance(name, str) or not name or any(p in ('','..','.') for p in name.split('/')) or ':' in name or '\\' in name or not (directory/name).is_file(), 'missing_resource')

def write_json(path, data):
    temp = path.with_suffix('.tmp')
    with temp.open('w',encoding='utf-8') as file:
        json.dump(data,file,sort_keys=True); file.flush(); os.fsync(file.fileno())
    os.replace(temp,path)

@contextlib.contextmanager
def locked(root):
    no_links(root)
    reject(not root.is_dir(), 'bootstrap_required')
    # OS-released lock survives crashes without stale sentinel lockouts.
    with (root/'update.lock').open('a+b') as file:
        if file.seek(0, os.SEEK_END) == 0:
            file.write(b'0'); file.flush()
        file.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:
            raise Rejected('busy') from exc
        try:
            yield
        finally:
            file.seek(0)
            if os.name == 'nt':
                msvcrt.locking(file.fileno(),msvcrt.LK_UNLCK,1)
            else:
                fcntl.flock(file,fcntl.LOCK_UN)

def recover(root):
    journal = root/'transaction.json'; old=root/'previous'; live=root/'extension'
    if journal.exists():
        prior = json.loads(journal.read_text('utf-8'))
        if old.exists():
            if live.exists(): shutil.rmtree(live)
            os.replace(old,live)
        write_json(root/'state.json',prior)
        journal.unlink()
    if (root/'stage').exists(): shutil.rmtree(root/'stage')
    if old.exists(): shutil.rmtree(old)

def update(root=ROOT, public_key=PUBLIC_KEY, fetch=download, now=None):
    reject(len(public_key)!=32, 'trust_not_configured')
    with locked(root):
        recover(root)
        state=json.loads((root/'state.json').read_text('utf-8'))
        current=json.loads((root/'extension'/'manifest.json').read_text('utf-8'))['version']
        reject(set(state)!={'sequence','version'} or type(state['sequence']) is not int or state['sequence']<0 or state['version']!=current, 'local_state')
        m=metadata(fetch(META_URL,16384),public_key,int(time.time()) if now is None else now)
        reject(m['sequence']<state['sequence'] or version(m['version'])<version(current), 'downgrade')
        if m['sequence']==state['sequence'] and m['version']==current: return 'current'
        reject(m['sequence']<=state['sequence'] or version(m['version'])<=version(current), 'replay')
        blob=fetch(f"https://github.com/{REPO}/releases/download/{m['tag']}/{ASSET}", MAX_ARCHIVE)
        reject(len(blob)!=m['size'] or hashlib.sha256(blob).hexdigest()!=m['sha256'], 'asset_hash')
        stage=root/'stage'; stage.mkdir()
        try:
            unpack(blob,stage,m['version'])
            compatible(json.loads((root/'extension'/'manifest.json').read_text('utf-8')),
                       json.loads((stage/'manifest.json').read_text('utf-8')), stage)
            write_json(root/'transaction.json',state)
            os.replace(root/'extension',root/'previous')
            os.replace(stage,root/'extension')
            write_json(root/'state.json',{'sequence':m['sequence'],'version':m['version']})
            (root/'transaction.json').unlink()  # Commit point. Recovery otherwise rolls back.
        except Exception:
            recover(root)
            raise
        try:
            shutil.rmtree(root/'previous')
        except OSError:
            pass  # Already committed; never suppress reload for cleanup failure.
        return 'updated'

def request(stream):
    header=stream.read(4)
    reject(len(header)!=4,'frame')
    size=struct.unpack('<I',header)[0]
    reject(not 1<=size<=1024,'frame')
    raw=stream.read(size); reject(len(raw)!=size,'frame')
    try: value=json.loads(raw)
    except Exception as exc: raise Rejected('request') from exc
    reject(value!={'protocol':1,'action':'update'} or type(value.get('protocol')) is not int,'request')

def validate_origin(origin, ids):
    reject(not ids or any(not re.fullmatch('[a-p]{32}',i) for i in ids),'trust_not_configured')
    reject(origin not in {f'chrome-extension://{i}/' for i in ids},'origin')

def main():
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY); msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    try:
        validate_origin(sys.argv[1] if len(sys.argv)>1 else '', EXTENSION_IDS)
        request(sys.stdin.buffer)
        result={'protocol':1,'status':update()}
    except Rejected as exc: result={'protocol':1,'status':'error','code':str(exc)}
    except Exception: result={'protocol':1,'status':'error','code':'update_failed'}
    raw=canonical(result); sys.stdout.buffer.write(struct.pack('<I',len(raw))+raw); sys.stdout.buffer.flush()

if __name__=='__main__': main()
