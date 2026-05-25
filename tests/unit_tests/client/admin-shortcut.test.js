/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import '../../../public/utils/admin-shortcut.js';

// admin-shortcut.js runs side-effects at import time:
// it creates an <a> and appends it to document.body.

describe('admin-shortcut', () => {
  it('ajoute un élément au body', () => {
    const btn = document.querySelector('.admin-shortcut-btn');
    expect(btn).not.toBeNull();
  });

  it('est un lien <a>', () => {
    const btn = document.querySelector('.admin-shortcut-btn');
    expect(btn.tagName).toBe('A');
  });

  it('pointe vers /admin.html', () => {
    const btn = document.querySelector('.admin-shortcut-btn');
    expect(btn.getAttribute('href')).toBe('/admin.html');
  });

  it('a le title "Admin"', () => {
    const btn = document.querySelector('.admin-shortcut-btn');
    expect(btn.title).toBe('Admin');
  });

  it('contient un SVG avec un path', () => {
    const btn = document.querySelector('.admin-shortcut-btn');
    const svg = btn.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('n\'ajoute qu\'un seul bouton (pas de doublon à l\'import)', () => {
    const btns = document.querySelectorAll('.admin-shortcut-btn');
    expect(btns).toHaveLength(1);
  });
});
