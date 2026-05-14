import { describe, it, expect } from 'vitest';
import { formatViews, formatLikes } from '../../public/utils/format.js';

describe('formatViews', () => {
  it('displays "1 view" singular', () => {
    expect(formatViews(1)).toBe('1 view');
  });

  it('displays plural for n > 1', () => {
    expect(formatViews(0)).toBe('0 views');
    expect(formatViews(2)).toBe('2 views');
    expect(formatViews(999)).toBe('999 views');
  });

  it('formats in k for thousands', () => {
    expect(formatViews(1_000)).toBe('1 k views');
    expect(formatViews(1_500)).toBe('1.5 k views');
    expect(formatViews(10_000)).toBe('10 k views');
    expect(formatViews(999_999)).toBe('1000 k views');
  });

  it('drops unnecessary .0 in k', () => {
    expect(formatViews(2_000)).toBe('2 k views');
    expect(formatViews(5_000)).toBe('5 k views');
  });

  it('formats in M for millions', () => {
    expect(formatViews(1_000_000)).toBe('1 M views');
    expect(formatViews(2_500_000)).toBe('2.5 M views');
  });
});

describe('formatLikes', () => {
  it('returns empty string for 0', () => {
    expect(formatLikes(0)).toBe('');
  });

  it('returns the number as a string', () => {
    expect(formatLikes(1)).toBe('1');
    expect(formatLikes(42)).toBe('42');
    expect(formatLikes(999)).toBe('999');
  });

  it('formats in k for thousands', () => {
    expect(formatLikes(1_000)).toBe('1 k');
    expect(formatLikes(1_500)).toBe('1.5 k');
  });

  it('formats in M for millions', () => {
    expect(formatLikes(1_000_000)).toBe('1 M');
    expect(formatLikes(2_500_000)).toBe('2.5 M');
  });

  it('drops unnecessary .0', () => {
    expect(formatLikes(3_000)).toBe('3 k');
    expect(formatLikes(4_000_000)).toBe('4 M');
  });
});
