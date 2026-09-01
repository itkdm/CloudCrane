export type PreviewViewportMode = 'desktop' | 'mobile';

export type PreviewViewport = {
  width: number;
  height: number;
};

export const PREVIEW_VIEWPORTS: Record<PreviewViewportMode, PreviewViewport> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

export function getPreviewViewport(mode: PreviewViewportMode): PreviewViewport {
  return PREVIEW_VIEWPORTS[mode];
}

export function calculatePreviewScale(
  availableWidth: number,
  availableHeight: number,
  viewport: PreviewViewport,
): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return 1;

  const scale = Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
