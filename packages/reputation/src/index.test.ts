import { describe, expect, it } from 'vitest';
import { __testables } from './index.js';

const { clamp, scoreToLabel, explanationFromSignals } = __testables as {
  clamp: (value: number, min?: number, max?: number) => number;
  scoreToLabel: (score: number, isActive: boolean) => string;
  explanationFromSignals: (ageDays: number, weight: number, isActive: boolean) => string;
};

describe('reputation helpers', () => {
  it('clamps values between bounds', () => {
    expect(clamp(1.5)).toBe(1);
    expect(clamp(-0.2)).toBe(0);
    expect(clamp(0.4)).toBe(0.4);
  });

  it('maps scores to labels respecting active state', () => {
    expect(scoreToLabel(0.8, true)).toBe('Trusted');
    expect(scoreToLabel(0.5, true)).toBe('Limited history');
    expect(scoreToLabel(0.3, true)).toBe('Warning');
    expect(scoreToLabel(0.9, false)).toBe('Not protected');
  });

  it('generates readable explanations from signals', () => {
    const newLabel = explanationFromSignals(2, 1, true);
    expect(newLabel).toContain('new');

    const oldTrusted = explanationFromSignals(200, 10, true);
    expect(oldTrusted).toContain('active for quite a while');
    expect(oldTrusted).toContain('healthy');

    const inactive = explanationFromSignals(5, 0, false);
    expect(inactive).toBe('This Identik Name is not currently active.');
  });
});
