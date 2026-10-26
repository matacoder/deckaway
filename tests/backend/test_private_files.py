import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

from support import ROOT
sys.path.insert(0, str(ROOT))
from integrations.private_files import write_private


class PrivateFileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'settings.json'

    def test_file_then_replacement_then_parent_directory_are_synced(self):
        events = []
        sync, replace = os.fsync, os.replace
        def fsync(fd):
            events.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            sync(fd)
        def rename(source, target):
            events.append('replace')
            replace(source, target)
        with patch('integrations.private_files.os.fsync', side_effect=fsync), \
                patch('integrations.private_files.os.replace', side_effect=rename):
            write_private(self.path, 'private settings')
        self.assertEqual(events, ['file', 'replace', 'directory'])
        self.assertEqual(self.path.read_text(), 'private settings')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_directory_sync_failure_is_reported_and_the_descriptor_is_closed(self):
        descriptors, sync = [], os.fsync
        def fsync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                descriptors.append(fd)
                raise OSError('sync failed')
            sync(fd)
        with patch('integrations.private_files.os.fsync', side_effect=fsync):
            with self.assertRaises(OSError):
                write_private(self.path, b'private settings')
        self.assertEqual(len(descriptors), 1)
        with self.assertRaises(OSError):
            os.fstat(descriptors[0])
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])
