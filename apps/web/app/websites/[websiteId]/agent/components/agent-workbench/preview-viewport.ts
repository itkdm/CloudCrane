export type PreviewViewportMode = 'desktop' | 'mobile';

export type PreviewViewport = {
  width: number;
};

export const PREVIEW_VIEWPORTS: Record<PreviewViewportMode, PreviewViewport> = {
  desktop: { width: 1440 },
  mobile: { width: 390 },
};

export type PreviewViewportLayout = {
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  visualWidth: number;
  visualHeight: number;
};

export function getPreviewViewport(mode: PreviewViewportMode): PreviewViewport {
  return PREVIEW_VIEWPORTS[mode];
}

export function calculatePreviewScale(availableWidth: number, viewport: PreviewViewport): number {
  if (
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    viewport.width <= 0 ||
    !Number.isFinite(viewport.width)
  )
    return 1;

  const scale = Math.min(1, availableWidth / viewport.width);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function calculatePreviewViewportLayout(
  availableWidth: number,
  availableHeight: number,
  viewport: PreviewViewport,
): PreviewViewportLayout {
  const scale = calculatePreviewScale(availableWidth, viewport);
  const safeHeight = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const logicalHeight = Math.max(1, Math.floor(safeHeight / scale));

  return {
    logicalWidth: viewport.width,
    logicalHeight,
    scale,
    visualWidth: viewport.width * scale,
    visualHeight: logicalHeight * scale,
  };
}
