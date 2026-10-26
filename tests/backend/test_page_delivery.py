import gzip
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from integrations.page_delivery import Pages, accepts_gzip


class PageDeliveryTests(unittest.TestCase):
    def test_render_and_compression_are_shared_per_file_version_and_language(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'index.html'
            path.write_text('hello __PANEL_REVISION__')
            pages, render = Pages(), Mock(side_effect=lambda text: 'en:' + text)
            with patch('integrations.page_delivery.gzip.compress', wraps=gzip.compress) as compress:
                first = pages.get(path, 'en', render)
                self.assertEqual(first, pages.get(path, 'en', render))
                render.assert_called_once()
                compress.assert_called_once()
                self.assertEqual(gzip.decompress(first[1]), first[0])
                translated = pages.get(path, 'fr', lambda text: 'fr:' + text)
                self.assertNotEqual(translated[0], first[0])
                self.assertEqual(translated[2], first[2])
                path.write_text('updated __PANEL_REVISION__')
                updated = pages.get(path, 'en', render)
                self.assertNotEqual(updated[2], first[2])
                self.assertEqual(render.call_count, 2)

    def test_quality_values_and_explicit_exclusion_are_respected(self):
        for header in ('gzip', 'br, gzip;q=0.5', '*;q=1', 'GZIP; q=1'):
            self.assertTrue(accepts_gzip(header), header)
        for header in ('', 'br', 'gzip;q=0', '*;q=1, gzip;q=0', 'gzip;q=invalid', 'gzip;q=2'):
            self.assertFalse(accepts_gzip(header), header)
