import { describe, it, expect } from 'vitest';
import { isImage, isVideo, isMedia, isAlbumDir } from '../../../services/image.js';

// ── isImage ───────────────────────────────────────────────────────────────────

describe('isImage', () => {
  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif', '.avif'])(
    "accepte l'extension %s",
    ext => expect(isImage(`photo${ext}`)).toBe(true),
  );

  it.each(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif'])(
    "accepte l'extension en majuscules %s",
    ext => expect(isImage(`photo${ext.toUpperCase()}`)).toBe(true),
  );

  it.each(['.mp4', '.pdf', '.txt', '.raw', '.gif'])(
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

describe('isVideo / isMedia (F1)', () => {
  it.each(['clip.mp4', 'CLIP.MOV', 'a.m4v', 'b.webm'])('%s est une vidéo et un média', (f) => {
    expect(isVideo(f)).toBe(true);
    expect(isMedia(f)).toBe(true);
    expect(isImage(f)).toBe(false);
  });
  it.each(['IMG_0001.HEIC', 'x.jpg'])('%s est un média mais pas une vidéo', (f) => {
    expect(isMedia(f)).toBe(true);
    expect(isVideo(f)).toBe(false);
  });
  it.each(['script.sh', 'doc.pdf', 'anim.gif', 'noext'])('%s n\'est pas un média', (f) => expect(isMedia(f)).toBe(false));
});
