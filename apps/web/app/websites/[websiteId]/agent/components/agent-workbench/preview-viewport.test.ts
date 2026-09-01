import { describe, expect, it } from 'vitest';
import {
  calculatePreviewScale,
  getPreviewViewport,
  type PreviewViewport,
} from './preview-viewport';

describe('preview viewport scale', () => {
  it('fits desktop 1440x900 into a 720x600 stage', () => {
    expect(calculatePreviewScale(720, 600, getPreviewViewport('desktop'))).toBe(0.5);
  });

  it('does not enlarge mobile 390x844 inside an 800x900 stage', () => {
    expect(calculatePreviewScale(800, 900, getPreviewViewport('mobile'))).toBe(1);
  });

  it('changes only the visual scale when the stage changes', () => {
    const viewport = getPreviewViewport('desktop');
    expect(viewport).toEqual({ width: 1440, height: 900 });
    expect(calculatePreviewScale(720, 600, viewport)).toBe(0.5);
    expect(calculatePreviewScale(1200, 600, viewport)).toBe(2 / 3);
    expect(viewport).toEqual({ width: 1440, height: 900 });
  });

  it('keeps the scale finite and positive for an extremely small stage', () => {
    const viewport: PreviewViewport = { width: 1440, height: 900 };
    expect(calculatePreviewScale(0, 0, viewport)).toBeGreaterThan(0);
    expect(Number.isFinite(calculatePreviewScale(Number.NaN, Infinity, viewport))).toBe(true);
  });
});
