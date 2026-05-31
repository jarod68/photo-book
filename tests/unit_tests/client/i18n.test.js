/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem:    key => (key in store ? store[key] : null),
    setItem:    (key, val) => { store[key] = String(val); },
    removeItem: key => { delete store[key]; },
    clear:      () => { for (const k in store) delete store[k]; },
  };
}

// Stub localStorage BEFORE the import so the module boots in a known language (fr)
vi.stubGlobal('localStorage', makeStorage({ lang: 'fr' }));

const { getLang, t, setLang, applyTranslations, initLangSwitcher } = await import('../../../public/utils/i18n.js');

// ── getLang ───────────────────────────────────────────────────────────────────

describe('getLang', () => {
  it('retourne \'fr\' quand stocké dans localStorage', () => {
    expect(getLang()).toBe('fr');
  });

  it('retourne \'en\' si la langue stockée n\'est pas supportée', () => {
    const storage = makeStorage({ lang: 'de' });
    vi.stubGlobal('localStorage', storage);
    expect(getLang()).toBe('en');
    vi.stubGlobal('localStorage', makeStorage({ lang: 'fr' }));
  });

  it('retourne \'en\' si localStorage est vide et navigator.language non supporté', () => {
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(getLang()).toBe('en');
    vi.stubGlobal('localStorage', makeStorage({ lang: 'fr' }));
  });
});

// ── t ─────────────────────────────────────────────────────────────────────────

describe('t', () => {
  it('retourne la traduction FR pour une clé connue', () => {
    // The module was loaded with lang='fr', so messages = fr
    expect(t('nav.back')).toBe('← Retour');
  });

  it('retourne la clé si elle n\'existe pas dans les messages', () => {
    expect(t('clé.inconnue')).toBe('clé.inconnue');
  });

  it('interpole les variables dans la traduction', () => {
    // 'viewer.deleteConfirm': 'Supprimer « {filename} » ?'
    const result = t('viewer.deleteConfirm', { filename: 'photo.jpg' });
    expect(result).toBe('Supprimer « photo.jpg » ?');
  });

  it('interpole plusieurs variables', () => {
    // 'viewer.deleteError': 'Erreur lors de la suppression : {msg}'
    const result = t('viewer.deleteError', { msg: 'Accès refusé' });
    expect(result).toBe('Erreur lors de la suppression : Accès refusé');
  });
});

// ── setLang ───────────────────────────────────────────────────────────────────

describe('setLang', () => {
  it('écrit la nouvelle langue dans localStorage', () => {
    const storage = makeStorage({ lang: 'fr' });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('location', { reload: vi.fn(), href: '' });
    setLang('en');
    expect(storage.getItem('lang')).toBe('en');
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', makeStorage({ lang: 'fr' }));
  });

  it('appelle location.reload()', () => {
    const reloadMock = vi.fn();
    vi.stubGlobal('location', { reload: reloadMock, href: '' });
    setLang('es');
    expect(reloadMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', makeStorage({ lang: 'fr' }));
  });
});

// ── applyTranslations ─────────────────────────────────────────────────────────

describe('applyTranslations', () => {
  it('applique data-i18n comme textContent', () => {
    const el = document.createElement('span');
    el.dataset.i18n = 'nav.back';
    document.body.appendChild(el);
    applyTranslations(document.body);
    expect(el.textContent).toBe('← Retour');
    document.body.removeChild(el);
  });

  it('applique data-i18n-title comme title', () => {
    const el = document.createElement('button');
    el.dataset.i18nTitle = 'viewer.close';
    document.body.appendChild(el);
    applyTranslations(document.body);
    expect(el.title).toBe('Fermer');
    document.body.removeChild(el);
  });

  it('applique data-i18n-aria comme aria-label', () => {
    const el = document.createElement('button');
    el.dataset.i18nAria = 'viewer.download';
    document.body.appendChild(el);
    applyTranslations(document.body);
    expect(el.getAttribute('aria-label')).toBe('Télécharger');
    document.body.removeChild(el);
  });

  it('applique data-i18n-placeholder comme placeholder', () => {
    const el = document.createElement('input');
    el.dataset.i18nPlaceholder = 'nav.signIn';
    document.body.appendChild(el);
    applyTranslations(document.body);
    expect(el.placeholder).toBe('Connexion');
    document.body.removeChild(el);
  });
});

// ── initLangSwitcher ──────────────────────────────────────────────────────────

describe('initLangSwitcher', () => {
  afterEach(() => {
    // Clean up any containers added during tests
    document.querySelectorAll('[data-test-lang-switcher]').forEach(el => el.remove());
  });

  function makeContainer(id = 'lang-switcher-test') {
    const div = document.createElement('div');
    div.id = id;
    div.setAttribute('data-test-lang-switcher', '');
    document.body.appendChild(div);
    return div;
  }

  it('ne fait rien si le container n\'existe pas', () => {
    // Should not throw
    expect(() => initLangSwitcher('non-existent-id')).not.toThrow();
  });

  it('crée un .lang-btn dans le container', () => {
    const container = makeContainer('sw1');
    initLangSwitcher('sw1');
    expect(container.querySelector('.lang-btn')).not.toBeNull();
  });

  it('crée un .lang-menu dans le container', () => {
    const container = makeContainer('sw2');
    initLangSwitcher('sw2');
    expect(container.querySelector('.lang-menu')).not.toBeNull();
  });

  it('crée exactement 3 éléments .lang-option', () => {
    const container = makeContainer('sw3');
    initLangSwitcher('sw3');
    const options = container.querySelectorAll('.lang-option');
    expect(options).toHaveLength(3);
  });

  it('le menu est caché par défaut', () => {
    const container = makeContainer('sw4');
    initLangSwitcher('sw4');
    const menu = container.querySelector('.lang-menu');
    expect(menu.hidden).toBe(true);
  });

  it('le bouton affiche le code langue en majuscules', () => {
    const container = makeContainer('sw5');
    initLangSwitcher('sw5');
    const btn = container.querySelector('.lang-btn');
    // The module was loaded with lang='fr' → button shows 'FR'
    expect(btn.textContent).toContain('FR');
  });

  it('cliquer sur le bouton ouvre le menu', () => {
    const container = makeContainer('sw6');
    initLangSwitcher('sw6');
    const btn  = container.querySelector('.lang-btn');
    const menu = container.querySelector('.lang-menu');
    btn.click();
    expect(menu.hidden).toBe(false);
  });

  it('un second clic sur le bouton ferme le menu', () => {
    const container = makeContainer('sw7');
    initLangSwitcher('sw7');
    const btn  = container.querySelector('.lang-btn');
    const menu = container.querySelector('.lang-menu');
    btn.click(); // open
    btn.click(); // close
    expect(menu.hidden).toBe(true);
  });

  it('un clic sur le document ferme le menu', () => {
    const container = makeContainer('sw8');
    initLangSwitcher('sw8');
    const btn  = container.querySelector('.lang-btn');
    const menu = container.querySelector('.lang-menu');
    btn.click(); // open
    document.dispatchEvent(new MouseEvent('click'));
    expect(menu.hidden).toBe(true);
  });

  it('la touche Escape ferme le menu', () => {
    const container = makeContainer('sw9');
    initLangSwitcher('sw9');
    const btn  = container.querySelector('.lang-btn');
    const menu = container.querySelector('.lang-menu');
    btn.click(); // open
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.hidden).toBe(true);
  });
});
