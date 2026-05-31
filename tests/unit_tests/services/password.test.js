import { describe, it, expect } from 'vitest';
import { generatePassword, validatePassword } from '../../../services/password.js';

// ── generatePassword ──────────────────────────────────────────────────────────

describe('generatePassword', () => {
  it('retourne une chaîne non vide', () => {
    expect(generatePassword()).toBeTypeOf('string');
    expect(generatePassword().length).toBeGreaterThan(0);
  });

  it('commence par une majuscule', () => {
    expect(generatePassword()[0]).toMatch(/[A-Z]/);
  });

  it('contient au moins un caractère spécial parmi !@#$&*+=', () => {
    expect(generatePassword()).toMatch(/[!@#$&*+=]/);
  });

  it('contient des chiffres en fin', () => {
    expect(generatePassword()).toMatch(/\d{3}$/);
  });

  it('génère des mots de passe différents à chaque appel', () => {
    const a = generatePassword();
    const b = generatePassword();
    const c = generatePassword();
    // Probabilité d'égalité = 1/(nb_mots²) ≈ négligeable
    expect([a, b, c].every(p => p === a)).toBe(false);
  });

  it('passe lui-même validatePassword', () => {
    for (let i = 0; i < 10; i++) {
      expect(validatePassword(generatePassword())).toBeNull();
    }
  });
});

// ── validatePassword ──────────────────────────────────────────────────────────

describe('validatePassword', () => {
  it('retourne un message si password est absent', () => {
    expect(validatePassword(undefined)).toBe('Password is required');
    expect(validatePassword(null)).toBe('Password is required');
  });

  it('retourne un message si password n\'est pas une chaîne', () => {
    expect(validatePassword(123)).toBe('Password is required');
    expect(validatePassword({})).toBe('Password is required');
  });

  it('retourne un message si password est une chaîne vide', () => {
    expect(validatePassword('')).toBe('Password is required');
  });

  it('retourne un message si moins de 8 caractères', () => {
    expect(validatePassword('Ab1!')).toBe('At least 8 characters required');
    expect(validatePassword('Ab1!xyz')).toBe('At least 8 characters required');
  });

  it('retourne un message si aucune majuscule', () => {
    expect(validatePassword('abcdef1!')).toBe('At least one uppercase letter required');
  });

  it('retourne un message si aucune minuscule', () => {
    expect(validatePassword('ABCDEF1!')).toBe('At least one lowercase letter required');
  });

  it('retourne un message si aucun chiffre', () => {
    expect(validatePassword('Abcdefg!')).toBe('At least one digit required');
  });

  it('retourne un message si aucun caractère spécial', () => {
    expect(validatePassword('Abcdef12')).toBe('At least one special character required');
  });

  it('retourne null pour un mot de passe valide', () => {
    expect(validatePassword('Abcdef1!')).toBeNull();
    expect(validatePassword('P@ssw0rd')).toBeNull();
    expect(validatePassword('Hello#World9')).toBeNull();
  });
});
