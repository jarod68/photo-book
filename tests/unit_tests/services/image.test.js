import { describe, it, expect } from 'vitest';
import { isImage, isAlbumDir } from '../../../services/image.js';

// ── isImage ───────────────────────────────────────────────────────────────────

describe('isImage', () => {
  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'])(
    "accepte l'extension %s",
    ext => expect(isImage(`photo${ext}`)).toBe(true),
  );

  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'])(
    "accepte l'extension en majuscules %s",
    ext => expect(isImage(`photo${ext.toUpperCase()}`)).toBe(true),
  );

  it.each(['.mp4', '.pdf', '.txt', '.raw', '.gif', '.heic'])(
    "rejette l'extension %s",
    ext => expect(isImage(`file${ext}`)).toBe(false),
  );

  it('rejette une chaîne vide', () => {
    expect(isImage('')).toBe(false);
  });

  it('rejette un fichier sans extension', () => {
    expect(isImage('noextension')).toBe(false);
  });
});

// ── isAlbumDir ────────────────────────────────────────────────────────────────

const dir  = name => ({ isDirectory: () => true,  name });
const file = name => ({ isDirectory: () => false, name });

describe('isAlbumDir', () => {
  it('accepte un dossier commençant par une lettre', () => {
    expect(isAlbumDir(dir('Paris'))).toBe(true);
    expect(isAlbumDir(dir('album2024'))).toBe(true);
  });

  it('accepte un dossier commençant par un chiffre', () => {
    expect(isAlbumDir(dir('2024-Paris'))).toBe(true);
  });

  it('rejette un dossier commençant par un point', () => {
    expect(isAlbumDir(dir('.hidden'))).toBe(false);
  });

  it('rejette un dossier commençant par un underscore', () => {
    expect(isAlbumDir(dir('_private'))).toBe(false);
  });

  it('rejette un dossier commençant par un tiret', () => {
    expect(isAlbumDir(dir('-draft'))).toBe(false);
  });

  it('rejette un fichier même si le nom est valide', () => {
    expect(isAlbumDir(file('Paris'))).toBe(false);
  });
});
