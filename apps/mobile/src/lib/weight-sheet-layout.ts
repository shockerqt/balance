/** Ordinary viewport coordinates in dp, not a native form-sheet detent. */
export type WeightSheetBounds = { y: number; height: number };
export type WeightSheetKeyboard = { screenY: number };

export function weightSheetOverlap(
  bounds: WeightSheetBounds | null,
  keyboard: WeightSheetKeyboard | null,
  zeroFrameIsNonOccluding: boolean | null = false,
): { overlap: number; ready: boolean } {
  const validBounds = bounds !== null && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.height) && bounds.height > 0;
  // Hide wins even when a new origin measurement is still pending.
  if (keyboard === null) return { overlap: 0, ready: validBounds };
  if (!validBounds || !Number.isFinite(keyboard.screenY)
    || (keyboard.screenY === 0 && zeroFrameIsNonOccluding === null)) return { overlap: 0, ready: false };
  if (keyboard.screenY === 0 && zeroFrameIsNonOccluding) return { overlap: 0, ready: true };
  return { overlap: Math.max(0, Math.min(bounds!.height, bounds!.y + bounds!.height - keyboard.screenY)), ready: true };
}

/** Undefined is bootstrap, not a zero-height body. F is reserved only by flow. */
export function weightSheetBodyCap(usableHeight: number | null, footerHeight: number | null): number | undefined {
  if (usableHeight === null || footerHeight === null || !Number.isFinite(usableHeight)
    || !Number.isFinite(footerHeight) || usableHeight <= 0 || footerHeight <= 0) return undefined;
  return Math.max(0, usableHeight - footerHeight);
}
