import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, Library, valid_map, safe_member


def package(name='testmap', corrupt=False, image_ext='.tga'):
    output = io.BytesIO()
    bsp = bytearray(144 + 72)
    bsp[:4] = b'IBSP'
    struct.pack_into('<i', bsp, 4, 47)
    struct.pack_into('<ii', bsp, 16, 144, 72)
    bsp[144:144+18] = b'textures/test/wall\0'
    with ZipFile(output, 'w') as z:
        z.writestr(f'maps/{name}.bsp', b'bad' if corrupt else bsp)
        z.writestr('scripts/test.shader', 'textures/test/wall { { map textures/test/image.tga } }\nrocketExplosion { { map textures/test/image.tga } }')
        z.writestr('textures/test/image'+image_ext, b'image')
    return output.getvalue()


class ResourcesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.library = Library(self.home, [self.home/'downloads'])

    def tearDown(self):
        self.library.pool.shutdown(wait=True)
        self.tmp.cleanup()

    def await_job(self, job):
        for _ in range(100):
            result = self.library.jobs[job['id']]
            if result['state'] in ('ready', 'error'):
                return result
            time.sleep(.01)
        self.fail('Resource preparation did not finish')

    def test_unknown_map_is_downloaded_verified_saved_and_reused(self):
        self.library.sources = {'maps': {'testmap': {'urls': ['https://maps.example/testmap.pk3']}}}
        with patch('server.urlopen', return_value=io.BytesIO(package())) as download:
            job = self.library.prepare('testmap')
            result = self.await_job(job)
            self.assertEqual(result['state'], 'ready', result)
            self.assertEqual(download.call_count, 1)
            self.assertEqual(self.library.prepare('testmap')['id'], job['id'])
            self.assertEqual(download.call_count, 1)
        self.assertTrue((self.home/'downloads/testmap.pk3').is_file())
        target = self.home/'packages'/Path(result['files'][0]['src']).name
        with ZipFile(target) as z:
            self.assertIn('maps/testmap.bsp', z.namelist())
            self.assertIn('textures/test/image.tga', z.namelist())

    def test_different_map_is_rejected_and_not_saved(self):
        self.library.sources = {'maps': {'testmap': {'urls': ['https://maps.example/testmap.pk3']}}}
        with patch('server.urlopen', return_value=io.BytesIO(package('wrong'))):
            result = self.await_job(self.library.prepare('testmap'))
        self.assertEqual(result['state'], 'error')
        self.assertFalse((self.home/'downloads/testmap.pk3').exists())
        self.assertFalse(list((self.home/'downloads').glob('*.partial')))

    def test_stock_jpeg_fallback_is_included_for_map_and_global_effect(self):
        (self.home/'downloads/testmap.pk3').write_bytes(package(image_ext='.jpg'))
        self.library.index()
        self.library.build_core()
        core = self.home/'packages'/Path(self.library.core['src']).name
        with ZipFile(core) as z:
            self.assertIn('textures/test/image.jpg', z.namelist())
        result = self.await_job(self.library.prepare('testmap'))
        self.assertEqual(result['state'], 'ready', result)
        target = self.home/'packages'/Path(result['files'][0]['src']).name
        with ZipFile(target) as z:
            self.assertIn('textures/test/image.jpg', z.namelist())

    def test_standalone_banner_or_skin_pack_cannot_override_stock_materials(self):
        (self.home/'downloads/pak00.pk3').write_bytes(package())
        with ZipFile(self.home/'downloads/zz-banner-replacement.pk3', 'w') as z:
            z.writestr('scripts/banner.shader', 'rocketExplosion { { map textures/custom/missing.jpg } }')
            z.writestr('textures/custom/skin.jpg', b'private replacement')
        self.library.index()
        self.assertIn('textures/test/image.tga', self.library.shaders['rocketexplosion'])
        self.assertNotIn('textures/custom/skin.jpg', self.library.members)

    def test_corrupt_bsp_is_not_published(self):
        (self.home/'downloads/testmap.pk3').write_bytes(package(corrupt=True))
        self.library.index()
        result = self.await_job(self.library.prepare('testmap'))
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['files'], [])

    def test_player_assets_are_loaded_separately_without_removing_common_sounds(self):
        with ZipFile(self.home/'downloads/pak00.pk3', 'w') as z:
            z.writestr('models/players/sarge/lower.md3', b'sarge geometry')
            z.writestr('models/players/sarge/default.tga', b'sarge texture')
            z.writestr('models/players/visor/lower.md3', b'visor geometry')
            z.writestr('sound/player/sarge/death1.wav', b'sarge sound')
            z.writestr('sound/player/footsteps/step1.wav', b'common footstep')
            z.writestr('scripts/player.shader', 'sargeSkin { { map models/players/sarge/default.tga } }')
        self.library.index()
        self.library.build_core()
        with ZipFile(self.home/'packages'/Path(self.library.core['src']).name) as z:
            self.assertFalse(any(n.startswith('models/players/') for n in z.namelist()))
            self.assertNotIn('sound/player/sarge/death1.wav', z.namelist())
            self.assertIn('sound/player/footsteps/step1.wav', z.namelist())
        files = self.library.player_packs(['sarge', 'sarge'])
        self.assertEqual(len(files), 1)
        with ZipFile(self.home/'packages'/Path(files[0]['src']).name) as z:
            self.assertIn('models/players/sarge/default.tga', z.namelist())
            self.assertIn('sound/player/sarge/death1.wav', z.namelist())
            self.assertNotIn('models/players/visor/lower.md3', z.namelist())
        self.assertEqual(self.library.player_packs(['unknown']), [])
        for models in [None, '../sarge', ['../sarge'], ['sarge'] * 5]:
            with self.assertRaises(ValueError): self.library.player_packs(models)

    def test_paths_and_urls_cannot_be_used_as_map_names(self):
        for name in ['../evil','https://localhost/secrets','map;quit','',None]:
            with self.assertRaises(ValueError): valid_map(name)
        self.assertFalse(safe_member('../../evil'))


if __name__ == '__main__':
    unittest.main()


class PlaybackPermissionsTest(unittest.TestCase):
    def response(self, file=None):
        handler = Handler.__new__(Handler)
        handler.wfile = io.BytesIO()
        handler.request_version = 'HTTP/1.1'
        handler.requestline = 'GET /demo-viewer/ HTTP/1.1'
        handler.path = '/demo-viewer/'
        handler.log_request = lambda *args: None
        if file:
            handler.file(file)
        else:
            handler.json({'message': 'Not found'}, 404)
        return handler.wfile.getvalue().split(b'\r\n\r\n', 1)

    def test_recording_is_denied_on_player_and_api_responses(self):
        with tempfile.TemporaryDirectory() as folder:
            page = Path(folder)/'index.html'
            page.write_text('<p>Player</p>')
            for file in (None, page):
                headers, body = self.response(file)
                self.assertIn(b'Permissions-Policy: microphone=(), camera=()', headers)
                self.assertTrue(body)
