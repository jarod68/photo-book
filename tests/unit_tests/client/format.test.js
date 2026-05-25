import { vi, describe, it, expect, beforeAll } from 'vitest';

vi.mock('../../../public/utils/i18n.js', () => {
  const fr = {
    'format.view':    '{n} vue',
    'format.views':   '{n} vues',
    'format.views_k': '{n} k vues',
    'format.views_M': '{n} M vues',
  };
  return {
    t: (key, vars = {}) => {
      let str = fr[key] ?? key;
      for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
      return str;
    },
    getLang:           () => 'fr',
    applyTranslations: () => {},
    initLangSwitcher:  () => {},
    setLang:           () => {},
  };
});

const { formatViews, formatLikes } = await import('../../../public/utils/format.js');

describe('formatViews', () => {
  it('affiche "1 vue" au singulier', () => {
    expect(formatViews(1)).toBe('1 vue');
  });

  it('affiche le pluriel pour n > 1', () => {
    expect(formatViews(0)).toBe('0 vues');
    expect(formatViews(2)).toBe('2 vues');
    expect(formatViews(999)).toBe('999 vues');
  });

  it('formate en k pour les milliers', () => {
    expect(formatViews(1_000)).toBe('1 k vues');
    expect(formatViews(1_500)).toBe('1.5 k vues');
    expect(formatViews(10_000)).toBe('10 k vues');
    expect(formatViews(999_999)).toBe('1000 k vues');
  });

  it('supprime le .0 inutile en k', () => {
    expect(formatViews(2_000)).toBe('2 k vues');
    expect(formatViews(5_000)).toBe('5 k vues');
  });

  it('formate en M pour les millions', () => {
    expect(formatViews(1_000_000)).toBe('1 M vues');
    expect(formatViews(2_500_000)).toBe('2.5 M vues');
  });
});

describe('formatLikes', () => {
  it('retourne une chaîne vide pour 0', () => {
    expect(formatLikes(0)).toBe('');
  });

  it('retourne le nombre sous forme de chaîne', () => {
    expect(formatLikes(1)).toBe('1');
    expect(formatLikes(42)).toBe('42');
    expect(formatLikes(999)).toBe('999');
  });

  it('formate en k pour les milliers', () => {
    expect(formatLikes(1_000)).toBe('1 k');
    expect(formatLikes(1_500)).toBe('1.5 k');
  });

  it('formate en M pour les millions', () => {
    expect(formatLikes(1_000_000)).toBe('1 M');
    expect(formatLikes(2_500_000)).toBe('2.5 M');
  });

  it('supprime le .0 inutile', () => {
    expect(formatLikes(3_000)).toBe('3 k');
    expect(formatLikes(4_000_000)).toBe('4 M');
  });
});
