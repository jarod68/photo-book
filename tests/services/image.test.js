import { describe, it, expect } from 'vitest';
import { isImage, isAlbumDir } from '../../services/image.js';

// ── isImage ───────────────────────────────────────────────────────────────────

describe('isImage', () => {
  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'])(
    'accepts extension %s',
    ext => expect(isImage(`photo${ext}`)).toBe(true),
  );

  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'])(
    'accepts uppercase extension %s',
    ext => expect(isImage(`photo${ext.toUpperCase()}`)).toBe(true),
  );

  it.each(['.mp4', '.pdf', '.txt', '.raw', '.gif', '.heic'])(
    'rejects extension %s',
    ext => expect(isImage(`file${ext}`)).toBe(false),
  );

  it('rejects an empty string', () => {
    expect(isImage('')).toBe(false);
  });

  it('rejects a file without extension', () => {
    expect(isImage('noextension')).toBe(false);
  });
});

// ── isAlbumDir ────────────────────────────────────────────────────────────────

const dir  = name => ({ isDirectory: () => true,  name });
const file = name => ({ isDirectory: () => false, name });

describe('isAlbumDir', () => {
  it('accepts a folder starting with a letter', () => {
    expect(isAlbumDir(dir('Paris'))).toBe(true);
    expect(isAlbumDir(dir('album2024'))).toBe(true);
  });

  it('accepts a folder starting with a digit', () => {
    expect(isAlbumDir(dir('2024-Paris'))).toBe(true);
  });

  it('rejects a folder starting with a dot', () => {
    expect(isAlbumDir(dir('.hidden'))).toBe(false);
  });

  it('rejects a folder starting with an underscore', () => {
    expect(isAlbumDir(dir('_private'))).toBe(false);
  });

  it('rejects a folder starting with a dash', () => {
    expect(isAlbumDir(dir('-draft'))).toBe(false);
  });

  it('rejects a file even if the name is valid', () => {
    expect(isAlbumDir(file('Paris'))).toBe(false);
  });
});
