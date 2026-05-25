"""Creates minimal valid PNG test fixtures using only Python builtins."""
import zlib, struct
from pathlib import Path

OUT = Path(__file__).parent


def png(width, height, r, g, b):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''.join(b'\x00' + bytes([r, g, b] * width) for _ in range(height))
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )


fixtures = [
    ('test-photo-1.png', 50, 50, 220,  60,  60),  # red
    ('test-photo-2.png', 50, 50,  60, 180,  60),  # green
    ('test-photo-3.png', 50, 50,  60,  60, 220),  # blue
]

for name, w, h, r, g, b in fixtures:
    path = OUT / name
    path.write_bytes(png(w, h, r, g, b))
    print(f"  created {path}")
