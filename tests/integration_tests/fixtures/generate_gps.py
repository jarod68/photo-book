"""Creates minimal TIFF fixtures with GPS EXIF for map route tests.

Photo layout (Montreal area, ~45.5N 73.5W):
  gps-a: 45.5017N, 73.5673W  2026-05-25  base point, today
  gps-b: 45.5107N, 73.5673W  2026-05-24  ~1 km north of A, yesterday
  gps-c: 45.5917N, 73.5673W  2026-05-25  ~10 km north of A, today
  gps-d: 45.5737N, 73.5673W  2024-05-25  ~8 km north of A, 2 years ago
  gps-e: 45.5800N, 73.5673W  2024-05-24  ~8.6 km north of A, 2 years+1 day ago

Expected buildSegments result (MAX_DAYS=21, MAX_KM=400):
  Segment 1 (old):    [gps-e, gps-d]        1-day gap <= 21d
  Segment 2 (recent): [gps-b, gps-a, gps-c]  1-day and 0-day gaps
  Break between gps-d and gps-b: ~730 days >> MAX_DAYS
"""
import struct
from pathlib import Path

OUT = Path(__file__).parent


def rational(num, den):
    return struct.pack('<II', num, den)


def to_dms(deg):
    d = int(deg)
    m_frac = (deg - d) * 60
    m = int(m_frac)
    s_num = round((m_frac - m) * 60 * 100)
    return [(d, 1), (m, 1), (s_num, 100)]


def ifd_entry(tag, type_, count, value_bytes):
    return struct.pack('<HHI', tag, type_, count) + value_bytes


def make_tiff(lat, lon, datetime_str):
    """Build a 1x1 grayscale TIFF with GPS IFD and DateTimeOriginal EXIF.

    Memory layout (all offsets from start of TIFF data):
      0:   TIFF header (8)
      8:   IFD0 — 11 entries: 2 + 11*12 + 4 = 138 bytes
      146: ExifIFD — 1 entry:  2 +  1*12 + 4 =  18 bytes
      164: DateTimeOriginal string (20 bytes, null-terminated)
      184: GPS IFD — 5 entries: 2 +  5*12 + 4 =  66 bytes
      250: GPSLatitude rationals (3 × 8 = 24 bytes)
      274: GPSLongitude rationals (3 × 8 = 24 bytes)
      298: image pixel (1 byte, grayscale)
    """
    lat_ref = b'N\x00' if lat >= 0 else b'S\x00'
    lon_ref = b'E\x00' if lon >= 0 else b'W\x00'
    lat_dms = to_dms(abs(lat))
    lon_dms = to_dms(abs(lon))

    dto = datetime_str.encode('ascii') + b'\x00'
    assert len(dto) == 20

    OFF_EXIF = 146
    OFF_DTO  = 164
    OFF_GPS  = 184
    OFF_LAT  = 250
    OFF_LON  = 274
    OFF_IMG  = 298

    out = b'II' + struct.pack('<HI', 42, 8)

    # IFD0 — 11 entries, sorted ascending by tag
    ifd0 = [
        ifd_entry(256,    3, 1, struct.pack('<HH', 1, 0)),         # ImageWidth
        ifd_entry(257,    3, 1, struct.pack('<HH', 1, 0)),         # ImageLength
        ifd_entry(258,    3, 1, struct.pack('<HH', 8, 0)),         # BitsPerSample
        ifd_entry(259,    3, 1, struct.pack('<HH', 1, 0)),         # Compression (none)
        ifd_entry(262,    3, 1, struct.pack('<HH', 1, 0)),         # PhotometricInterp (grayscale)
        ifd_entry(273,    4, 1, struct.pack('<I',  OFF_IMG)),      # StripOffsets
        ifd_entry(277,    3, 1, struct.pack('<HH', 1, 0)),         # SamplesPerPixel
        ifd_entry(278,    3, 1, struct.pack('<HH', 1, 0)),         # RowsPerStrip
        ifd_entry(279,    4, 1, struct.pack('<I',  1)),            # StripByteCounts
        ifd_entry(0x8769, 4, 1, struct.pack('<I',  OFF_EXIF)),     # ExifIFD pointer
        ifd_entry(0x8825, 4, 1, struct.pack('<I',  OFF_GPS)),      # GPS IFD pointer
    ]
    out += struct.pack('<H', len(ifd0))
    for e in ifd0:
        out += e
    out += struct.pack('<I', 0)

    assert len(out) == OFF_EXIF

    # ExifIFD — DateTimeOriginal only
    out += struct.pack('<H', 1)
    out += ifd_entry(0x9003, 2, 20, struct.pack('<I', OFF_DTO))
    out += struct.pack('<I', 0)

    assert len(out) == OFF_DTO
    out += dto

    assert len(out) == OFF_GPS

    # GPS IFD — 5 entries, sorted ascending by tag
    gps = [
        ifd_entry(0x0000, 1, 4, b'\x02\x03\x00\x00'),               # GPSVersionID
        ifd_entry(0x0001, 2, 2, lat_ref + b'\x00\x00'),             # GPSLatitudeRef
        ifd_entry(0x0002, 5, 3, struct.pack('<I', OFF_LAT)),         # GPSLatitude
        ifd_entry(0x0003, 2, 2, lon_ref + b'\x00\x00'),             # GPSLongitudeRef
        ifd_entry(0x0004, 5, 3, struct.pack('<I', OFF_LON)),         # GPSLongitude
    ]
    out += struct.pack('<H', len(gps))
    for e in gps:
        out += e
    out += struct.pack('<I', 0)

    assert len(out) == OFF_LAT
    for num, den in lat_dms:
        out += rational(num, den)

    assert len(out) == OFF_LON
    for num, den in lon_dms:
        out += rational(num, den)

    assert len(out) == OFF_IMG
    out += b'\x80'
    return out


fixtures = [
    # name     lat        lon         datetime
    ('gps-a', 45.5017, -73.5673, '2026:05:25 12:00:00'),
    ('gps-b', 45.5107, -73.5673, '2026:05:24 12:00:00'),
    ('gps-c', 45.5917, -73.5673, '2026:05:25 14:00:00'),
    ('gps-d', 45.5737, -73.5673, '2024:05:25 12:00:00'),
    ('gps-e', 45.5800, -73.5673, '2024:05:24 12:00:00'),
]

for name, lat, lon, dt in fixtures:
    path = OUT / f'{name}.tiff'
    path.write_bytes(make_tiff(lat, lon, dt))
    print(f'  created {path}')
