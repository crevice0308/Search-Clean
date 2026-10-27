import base64, hashlib, importlib.util, io, json, os, pathlib, struct, tempfile, unittest, zipfile
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
P=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('updater',P/'native/updater.py'); u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
NOW=1800000000
class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
        (self.root/'extension').mkdir();(self.root/'extension/manifest.json').write_text(json.dumps({'version':'1.0.0','manifest_version':3,'name':'Search Clean Lite','background':{'service_worker':'updater.js'}}));(self.root/'extension/old').write_text('old')
        u.write_json(self.root/'state.json',{'sequence':1,'version':'1.0.0'})
        self.key=Ed25519PrivateKey.generate();self.pub=self.key.public_key().public_bytes_raw()
        self.blob=self.archive();self.m={'schema':1,'repo':u.REPO,'channel':'stable','sequence':2,'version':'1.1.0','tag':'v1.1.0','asset':u.ASSET,'size':len(self.blob),'sha256':hashlib.sha256(self.blob).hexdigest(),'expires':NOW+3600}
    def archive(self, extra=None):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:
            z.writestr('extension/manifest.json',json.dumps({'version':'1.1.0','manifest_version':3,'name':'Search Clean Lite','background':{'service_worker':'updater.js'}}))
            for name in ['content.js','content.css','popup.html','updater.js']: z.writestr('extension/'+name,'fixture')
            if extra: z.writestr(*extra)
        return buffer.getvalue()
    def signed(self):
        return u.canonical({'signed':self.m,'signature':base64.b64encode(self.key.sign(u.canonical(self.m))).decode()})
    def fetch(self,url,limit):
        self.assertTrue(url.startswith('https://github.com/'+u.REPO+'/releases/'))
        return self.signed() if url==u.META_URL else self.blob
    def run_update(self):return u.update(self.root,self.pub,self.fetch,NOW)
    def test_update_and_current(self):
        (self.root/'browser-settings-simulation.json').write_text('{"enabled":false}')
        self.assertEqual(self.run_update(),'updated');self.assertEqual(self.run_update(),'current')
        self.assertEqual((self.root/'browser-settings-simulation.json').read_text(),'{"enabled":false}')
        self.assertFalse((self.root/'extension/old').exists())
    def test_unconfigured(self):
        with self.assertRaisesRegex(u.Rejected,'trust_not_configured'):u.update(self.root,b'',self.fetch,NOW)
    def test_tampered_signature(self):
        raw=json.loads(self.signed());raw['signed']['sequence']=999
        with self.assertRaisesRegex(u.Rejected,'signature'):u.metadata(u.canonical(raw),self.pub,NOW)
    def test_wrong_key(self):
        with self.assertRaises(u.Rejected):u.metadata(self.signed(),Ed25519PrivateKey.generate().public_key().public_bytes_raw(),NOW)
    def test_expiry(self):
        for expiry in [NOW,NOW-1,NOW+32*86400]:
            self.m['expires']=expiry
            with self.assertRaisesRegex(u.Rejected,'expired'):self.run_update()
    def test_repository_channel_asset(self):
        for key,value in [('repo','other/project'),('channel','preview'),('asset','evil.zip'),('tag','../../evil')]:
            original=self.m[key];self.m[key]=value
            with self.assertRaises(u.Rejected):self.run_update()
            self.m[key]=original
    def test_downgrade_replay(self):
        for seq,version in [(0,'1.1.0'),(1,'1.1.0'),(2,'0.9.0'),(2,'1.0.0')]:
            self.m.update(sequence=seq,version=version,tag='v'+version)
            with self.assertRaises(u.Rejected):self.run_update()
    def test_hash_mismatch(self):
        self.m['sha256']='0'*64
        with self.assertRaisesRegex(u.Rejected,'asset_hash'):self.run_update()
    def test_unsafe_archives(self):
        for path in ['../escape','extension/../escape','extension/AUX.txt','extension/a:stream','extension/a\\b','extension/CON/file','extension/content.JS','/extension/file','extension/file.']:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(u.Rejected):u.unpack(self.archive((path,'bad')),pathlib.Path(tmp),'1.1.0')
    def test_symlink_archive(self):
        info=zipfile.ZipInfo('extension/link');info.create_system=3;info.external_attr=(0o120777<<16)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(u.Rejected,'archive_type'):u.unpack(self.archive((info,'target')),pathlib.Path(tmp),'1.1.0')
    def test_symlink_local(self):
        (self.root/'extension/link').symlink_to(self.root/'state.json')
        with self.assertRaisesRegex(u.Rejected,'filesystem_link'):self.run_update()
    def test_lock(self):
        with u.locked(self.root):
            with self.assertRaisesRegex(u.Rejected,'busy'):self.run_update()
    def test_rename_failure_rolls_back(self):
        original=u.os.replace
        def fail(src,dst):
            if pathlib.Path(src).name=='stage':raise OSError('simulated locked Windows file')
            return original(src,dst)
        with patch.object(u.os,'replace',fail):
            with self.assertRaises(OSError):self.run_update()
        self.assertTrue((self.root/'extension/old').exists());self.assertEqual(json.loads((self.root/'state.json').read_text())['sequence'],1)
    def test_crash_recovery(self):
        prior={'sequence':1,'version':'1.0.0'};u.write_json(self.root/'transaction.json',prior)
        os.replace(self.root/'extension',self.root/'previous');(self.root/'extension').mkdir();(self.root/'extension/new').write_text('partial')
        u.write_json(self.root/'state.json',{'sequence':2,'version':'1.1.0'});u.recover(self.root)
        self.assertTrue((self.root/'extension/old').exists());self.assertEqual(json.loads((self.root/'state.json').read_text()),prior)
    def test_post_commit_cleanup_failure_still_updated(self):
        original=u.shutil.rmtree
        def fail(path, *args, **kwargs):
            if pathlib.Path(path).name=='previous': raise OSError('simulated AV lock')
            return original(path,*args,**kwargs)
        with patch.object(u.shutil,'rmtree',fail):self.assertEqual(self.run_update(),'updated')
        self.assertEqual(json.loads((self.root/'state.json').read_text())['sequence'],2)
    def test_lock_does_not_grow(self):
        for _ in range(10):
            with u.locked(self.root):pass
        self.assertEqual((self.root/'update.lock').stat().st_size,1)
    def test_manifest_capability_change(self):
        manifest=json.loads((self.root/'extension/manifest.json').read_text());manifest['permissions']=['storage']
        (self.root/'extension/manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(u.Rejected,'incompatible_manifest'):self.run_update()
        self.assertTrue((self.root/'extension/old').exists())
    def test_missing_resource(self):
        manifest={'background':{'service_worker':'missing.js'}}
        with self.assertRaisesRegex(u.Rejected,'missing_resource'):u.compatible(manifest,manifest,self.root/'extension')
    def test_origin(self):
        ids=('a'*32,);u.validate_origin('chrome-extension://'+'a'*32+'/',ids)
        for value in ['', 'https://example.com/', 'chrome-extension://'+'b'*32+'/', 'chrome-extension://'+'a'*32+'/popup.html']:
            with self.assertRaisesRegex(u.Rejected,'origin'):u.validate_origin(value,ids)
    def test_download_size_and_deadline(self):
        class Response:
            url=u.META_URL
            headers={}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read1(self,n):return b'x'*n
        class Opener:
            def open(self,*args,**kwargs):return Response()
        with patch.object(u.urllib.request,'build_opener',return_value=Opener()):
            with self.assertRaisesRegex(u.Rejected,'download_size'):u.download(u.META_URL,10)
            with patch.object(u.time,'monotonic',side_effect=[0,61]):
                with self.assertRaisesRegex(u.Rejected,'download_timeout'):u.download(u.META_URL,10)
    def test_protocol(self):
        raw=u.canonical({'protocol':1,'action':'update'});u.request(io.BytesIO(struct.pack('<I',len(raw))+raw))
        for raw in [b'{}',b'{"protocol":true,"action":"update"}',b'{"protocol":1,"action":"update","path":"C:/"}',b'{"protocol":1,"action":"exec"}']:
            with self.assertRaises(u.Rejected):u.request(io.BytesIO(struct.pack('<I',len(raw))+raw))
        for raw in [b'',struct.pack('<I',2048),struct.pack('<I',5)+b'{}']:
            with self.assertRaises(u.Rejected):u.request(io.BytesIO(raw))
    def test_urls(self):
        for url in ['http://github.com/'+u.REPO+'/releases/x','https://evil.com/a','https://github.com/other/repo/releases/a','https://user@github.com/'+u.REPO+'/releases/a','https://github.com:8080/'+u.REPO+'/releases/a']:
            with self.assertRaises(u.Rejected):u.safe_url(url)
    def test_version(self):
        for value in ['1','01.0.0','1.0.0-beta','65536.0.0',True]:
            with self.assertRaises(u.Rejected):u.version(value)
if __name__=='__main__':unittest.main()
