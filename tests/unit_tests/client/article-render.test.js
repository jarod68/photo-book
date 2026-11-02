import { describe, it, expect } from 'vitest';
import { renderArticle, inline, photoRefs, parseRef, refFor } from '../../../public/utils/article-render.js';

const photos = {
  'A/a.jpg': { previewUrl: '/p/a', mediumUrl: '/m/a', thumbUrl: '/t/a', name: 'a', width: 1200, height: 800 },
  'A/c.jpg': { previewUrl: '/p/c', thumbUrl: '/t/c', name: 'c', is360: true },
  'B/b.jpg': { previewUrl: '/p/b', thumbUrl: '/t/b', name: 'b' },
  'A/v.mp4': { type: 'video', url: '/photos/A/v.mp4', previewUrl: '/p/v' },
};
const render = (body, extra = {}) => renderArticle(body, { album: 'A', photos, ...extra });

describe('article : marques en ligne', () => {
  it('échappe tout le HTML', () => {
    expect(inline('<script>alert(1)</script> & "x"')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(render('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });

  it('gras, italique, code', () => {
    expect(inline('**gras** *ital* _ital_ `a*b*`')).toBe('<strong>gras</strong> <em>ital</em> <em>ital</em> <code>a*b*</code>');
    expect(inline('snake_case_name')).toBe('snake_case_name');
  });

  it('liens : web (nouvel onglet), mail, ce site ; jamais javascript:', () => {
    expect(inline('[x](https://ex.com)')).toBe('<a href="https://ex.com" target="_blank" rel="noopener noreferrer">x</a>');
    expect(inline('[m](mailto:a@b.c)')).toBe('<a href="mailto:a@b.c">m</a>');
    expect(inline('[v](viewer.html?album=A)')).toBe('<a href="viewer.html?album=A">v</a>');
    expect(inline('[x](javascript:alert)')).toBe('x');
    expect(inline('[x](//evil.com)')).toBe('x');
    expect(inline('[x](data:text/html,1)')).toBe('x');
  });
});

describe('article : blocs', () => {
  it('titres, citation, listes, séparateur, paragraphes', () => {
    const html = render('# Un\n### Deux\n\n> cite\n> encore\n\n- a\n- b\n\n1. x\n2) y\n\n---\n\nligne 1\nligne 2');
    expect(html).toBe([
      '<h2>Un</h2>', '<h3>Deux</h3>', '<blockquote><p>cite<br>encore</p></blockquote>',
      '<ul><li>a</li><li>b</li></ul>', '<ol><li>x</li><li>y</li></ol>', '<hr>', '<p>ligne 1<br>ligne 2</p>',
    ].join('\n'));
  });

  it('une photo seule : une figure en taille moyenne, sa légende, le lien vers le lecteur', () => {
    const html = render('![Le **port**](a.jpg)');
    expect(html).toContain('<figure class="art-photo">');
    expect(html).toContain('href="viewer.html?album=A&amp;photo=a.jpg"');
    expect(html).toContain('src="/m/a"');
    expect(html).toContain('width="1200" height="800"');
    expect(html).toContain('<figcaption>Le <strong>port</strong></figcaption>');
  });

  it('plusieurs photos de suite : une galerie ; une autre album avec <Album/fichier>', () => {
    const html = render('![](a.jpg)\n![x](<B/b.jpg>) ![](c.jpg)');
    expect(html).toMatch(/^<div class="art-gallery art-gallery--3">/);
    expect(html).toContain('src="/p/b"');
    expect(html).toContain('art-photo--360');
    expect(html.match(/<figure/g)).toHaveLength(3);
  });

  it('une photo au milieu du texte passe après le paragraphe', () => {
    expect(render('Avant ![](a.jpg) après.')).toMatch(/^<p>Avant après\.<\/p>\n<figure/);
  });

  it('photo manquante : omise, ou signalée dans l’éditeur', () => {
    expect(render('![](nope.jpg)')).toBe('');
    expect(render('![](nope.jpg)', { showMissing: true })).toBe('<div class="art-missing">A/nope.jpg</div>');
  });

  it('vidéo', () => {
    expect(render('![](v.mp4)')).toContain('<video controls preload="metadata" playsinline src="/photos/A/v.mp4" poster="/p/v">');
  });

  it('lien de partage ajouté aux images et aux liens', () => {
    const html = render('![](a.jpg)', { share: 'tok' });
    expect(html).toContain('src="/m/a?share=tok"');
    expect(html).toContain('photo=a.jpg&amp;share=tok');
  });

  it('accepte une Map', () => {
    expect(renderArticle('![](a.jpg)', { album: 'A', photos: new Map(Object.entries(photos)) })).toContain('/m/a');
  });
});

describe('article : références de photos', () => {
  it('parseRef / refFor / photoRefs', () => {
    expect(parseRef('Ibérie/a b.jpg', 'X')).toEqual({ album: 'Ibérie', file: 'a b.jpg' });
    expect(parseRef('a.jpg', 'X')).toEqual({ album: 'X', file: 'a.jpg' });
    expect(refFor('A', 'a.jpg', 'A')).toBe('<a.jpg>');
    expect(refFor('B', 'b.jpg', 'A')).toBe('<B/b.jpg>');
    expect(photoRefs('![t](a.jpg) et ![](<B/b c.jpg>)', 'A')).toEqual([
      { album: 'A', file: 'a.jpg', caption: 't' }, { album: 'B', file: 'b c.jpg', caption: '' },
    ]);
  });
});
