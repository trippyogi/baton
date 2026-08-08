import { describe, expect, it } from 'vitest';
import { fmtCost, fmtTokens, humanTime, timeAgo } from './index.js';

describe('@baton/sdk helpers', () => {
  it('formats cost and tokens', () => {
    expect(fmtCost(1.5)).toBe('$1.50');
    expect(fmtCost(0.0123)).toBe('$0.0123');
    expect(fmtTokens(1500)).toBe('1.5k');
  });

  it('handles empty timestamps', () => {
    expect(timeAgo(null)).toBe('—');
    expect(humanTime(undefined)).toBe('—');
  });
});
