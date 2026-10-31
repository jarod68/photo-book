import { describe, it, expect } from 'vitest';
import { zoneIndexAt, parseGmtOffset, offsetMinutes, formatOffset, zonePlace, zoneLabel } from '../../../public/utils/timezones.js';

// A 4×2 index: west half zone #0 (pixel value 1), east half zone #299 (value 300 = 44 + 1·256);
// one pixel left empty (a hairline gap).
function index() {
  const width = 4, height = 2, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, v = x < 2 ? 1 : 300;
    data[o] = v & 255; data[o + 1] = v >> 8;
  }
  data[(1 * width + 3) * 4] = 0; data[(1 * width + 3) * 4 + 1] = 0;
  return { data, width, height };
}

describe('timezones', () => {
  it('zoneIndexAt : pixel équirectangulaire, octet de poids fort, interstices', () => {
    const ix = index();
    expect(zoneIndexAt(ix, 45, -100)).toBe(0);
    expect(zoneIndexAt(ix, 45, 100)).toBe(299);
    expect(zoneIndexAt(ix, -45, 170)).toBe(299);      // empty pixel: a neighbour's zone
    expect(zoneIndexAt(ix, 90, 180)).toBe(299);       // edges clamped
    expect(zoneIndexAt({ data: new Uint8ClampedArray(32), width: 4, height: 2 }, 0, 0)).toBe(-1);
  });

  it('décalages : analyse, mise en forme, heure d\'été', () => {
    expect(parseGmtOffset('GMT+05:45')).toBe(345);
    expect(parseGmtOffset('GMT-03:30')).toBe(-210);
    expect(parseGmtOffset('GMT')).toBe(0);
    expect(formatOffset(60)).toBe('UTC+1');
    expect(formatOffset(-210)).toBe('UTC−3:30');
    expect(formatOffset(0)).toBe('UTC');
    expect(offsetMinutes('Europe/Paris', new Date(Date.UTC(2026, 6, 1)))).toBe(120);    // summer
    expect(offsetMinutes('Europe/Paris', new Date(Date.UTC(2026, 11, 1)))).toBe(60);    // winter
    expect(offsetMinutes('Asia/Kathmandu', new Date(Date.UTC(2026, 0, 1)))).toBe(345);
    expect(offsetMinutes('Etc/GMT+10', new Date())).toBe(-600);                        // Etc signs are inverted
  });

  it('libellé : lieu, heure locale, décalage', () => {
    expect(zonePlace('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zonePlace('Etc/GMT+10')).toBeNull();
    const l = zoneLabel('Asia/Tokyo', new Date(Date.UTC(2026, 9, 28, 15, 5)), 'fr');
    expect(l).toMatchObject({ place: 'Tokyo', offset: 'UTC+9', time: '00:05', minutes: 540 });
    expect(l.day).toMatch(/29/);                      // already the next day in Tokyo
  });
});

describe('decodeBorders', () => {
  it('lit le format binaire : zones, premier point absolu, puis écarts (millièmes de degré)', async () => {
    const { decodeBorders } = await import('../../../public/utils/timezones.js');
    const buf = new ArrayBuffer(4 + 16 + 2 * 4 + 16);
    const v = new DataView(buf);
    let o = 0;
    v.setUint32(o, 2, true); o += 4;
    // border 1: zones 3 / 300, three points
    v.setUint16(o, 3, true); v.setUint16(o + 2, 300, true); v.setUint32(o + 4, 3, true);
    v.setInt32(o + 8, 2350, true); v.setInt32(o + 12, 48850, true); o += 16;
    v.setInt16(o, 10, true); v.setInt16(o + 2, -5, true); o += 4;
    v.setInt16(o, -2000, true); v.setInt16(o + 2, 1000, true); o += 4;
    // border 2: one point only (degenerate but valid)
    v.setUint16(o, 0, true); v.setUint16(o + 2, 1, true); v.setUint32(o + 4, 1, true);
    v.setInt32(o + 8, -179999, true); v.setInt32(o + 12, -89000, true);
    const [b1, b2] = decodeBorders(buf);
    expect(b1.a).toBe(3); expect(b1.b).toBe(300);
    expect([...b1.coords].map((x) => +x.toFixed(3))).toEqual([2.35, 48.85, 2.36, 48.845, 0.36, 49.845]);
    expect([...b2.coords].map((x) => +x.toFixed(3))).toEqual([-179.999, -89]);
  });
});
