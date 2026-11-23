// Keyboard and measured root bounds use screen coordinates (dp). Subtract only
// actual overlap, so adjustResize and edge-to-edge/overlay keyboards both work.
export function screenObservation({ rootTop, composerTop, android = false }) {
  // Android measureInWindow can subtract the status-bar/visible-window origin,
  // returning a negative root Y even though the edge-to-edge root starts at 0.
  // Keyboard.screenY is screen-relative. Normalize both views to that space.
  const screenOffset = android ? Math.max(0, -rootTop) : 0;
  return { top: rootTop + screenOffset, composerTop: Number.isFinite(composerTop) ? composerTop + screenOffset : null, screenOffset };
}
export function composerCorrection({ current = 0, composerTop, composerHeight, keyboardTop, maximum = 500, clearance = 16 }) {
  if (!Number.isFinite(keyboardTop)) return 0;
  if (!Number.isFinite(composerTop) || !Number.isFinite(composerHeight) || composerHeight <= 0) return current;
  const overlap = composerTop + composerHeight - (keyboardTop - clearance);
  if (Math.abs(overlap) < 1) return current;
  return Math.max(0, Math.min(maximum, Math.ceil(current + overlap)));
}
export function chatLayout({ rootTop = 0, rootHeight, keyboardTop = null, topInset = 0 }) {
  const height = Math.max(0, rootHeight);
  const keyboardVisible = Number.isFinite(keyboardTop);
  const overlap = keyboardVisible ? Math.max(0, Math.min(height, rootTop + height - keyboardTop)) : 0;
  // Leave room for Android's IME/edge-to-edge inset discrepancy as well as
  // keyboard suggestion/tool rows; a tiny gap can leave the composer clipped.
  const bottom = keyboardVisible ? overlap + 32 : 85;
  const available = Math.max(0, height - bottom - topInset - 46);
  return {
    keyboardVisible,
    bottom,
    height: Math.min(available, keyboardVisible ? available : height * 0.53),
  };
}
