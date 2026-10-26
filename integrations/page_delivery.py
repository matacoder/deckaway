"""Precomputed identity and gzip copies of each localized panel revision."""
import gzip
import hashlib
from pathlib import Path
import threading


class Pages:
    def __init__(self):
        self.lock = threading.Lock()
        self.version = None
        self.source = b''
        self.revision = ''
        self.languages = {}

    def get(self, path, language, render):
        with self.lock:
            info = Path(path).stat()
            version = (str(path), info.st_mtime_ns, info.st_size)
            if version != self.version:
                self.source = Path(path).read_bytes()
                self.revision = hashlib.sha256(self.source).hexdigest()
                self.version, self.languages = version, {}
            if language not in self.languages:
                body = render(self.source.decode()).replace('__PANEL_REVISION__', self.revision).encode()
                self.languages[language] = (body, gzip.compress(body, mtime=0))
            return (*self.languages[language], self.revision)


def accepts_gzip(header):
    qualities = {}
    for item in header.lower().split(','):
        coding, *parameters = item.strip().split(';')
        quality = 1.0
        for parameter in parameters:
            if parameter.strip().startswith('q='):
                try:
                    quality = float(parameter.strip()[2:])
                except ValueError:
                    quality = 0.0
        qualities[coding] = quality
    return 0 < qualities.get('gzip', qualities.get('*', 0)) <= 1


pages = Pages()
