import { describe, expect, it } from 'vitest';
import {
  calculatePreviewScale,
  calculatePreviewViewportLayout,
  getPreviewViewport,
} from './preview-viewport';

describe('preview viewport scale', () => {
  it('fits desktop width in a 1000x560 canvas and derives height from the canvas', () => {
    const layout = calculatePreviewViewportLayout(1000, 560, getPreviewViewport('desktop'));
    expect(layout.logicalWidth).toBe(1440);
    expect(layout.scale).toBeCloseTo(1000 / 1440);
    expect(layout.logicalHeight).toBe(806);
    expect(layout.visualWidth).toBeCloseTo(1000);
    expect(layout.visualHeight).toBeCloseTo(806 * (1000 / 1440), 1);
  });

  it('keeps mobile at 100% in a wide canvas and derives its height', () => {
    const layout = calculatePreviewViewportLayout(1000, 560, getPreviewViewport('mobile'));
    expect(layout.logicalWidth).toBe(390);
    expect(layout.scale).toBe(1);
    expect(layout.logicalHeight).toBe(560);
    expect(layout.visualWidth).toBe(390);
    expect(layout.visualHeight).toBe(560);
  });

  it('fits a narrow mobile canvas by width while keeping height dynamic', () => {
    const layout = calculatePreviewViewportLayout(320, 500, getPreviewViewport('mobile'));
    expect(layout.scale).toBeCloseTo(320 / 390);
    expect(layout.logicalHeight).toBe(609);
    expect(layout.visualWidth).toBeCloseTo(320);
    expect(layout.visualHeight).toBeCloseTo(609 * (320 / 390), 1);
  });

  it('does not let height change the scale', () => {
    const viewport = getPreviewViewport('desktop');
    expect(calculatePreviewScale(1000, viewport)).toBeCloseTo(1000 / 1440);
    expect(calculatePreviewViewportLayout(1000, 200, viewport).scale).toBeCloseTo(1000 / 1440);
    expect(calculatePreviewViewportLayout(1000, 800, viewport).scale).toBeCloseTo(1000 / 1440);
  });

  it('keeps the layout valid for extremely small or invalid space', () => {
    const layout = calculatePreviewViewportLayout(0, 0, getPreviewViewport('desktop'));
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(1);
    expect(layout.logicalHeight).toBe(1);
    expect(Number.isFinite(calculatePreviewScale(Number.NaN, getPreviewViewport('mobile')))).toBe(
      true,
    );
  });
});
