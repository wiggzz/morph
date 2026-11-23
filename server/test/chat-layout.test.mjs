import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatLayout, composerCorrection, screenObservation } from '../../mobile/src/chatLayout.js';

test('chat keeps its compact floating size with the keyboard dismissed', () => {
  const layout = chatLayout({ rootHeight: 800, topInset: 24 });
  assert.equal(layout.keyboardVisible, false);
  assert.equal(layout.bottom, 85);
  assert.equal(layout.height, 424);
});

test('overlay and already-resized Android windows produce the same docked screen position', () => {
  const overlay = chatLayout({ rootTop: 24, rootHeight: 776, keyboardTop: 500, topInset: 24 });
  const resized = chatLayout({ rootTop: 24, rootHeight: 476, keyboardTop: 500, topInset: 24 });
  assert.equal(24 + 776 - overlay.bottom, 468);
  assert.equal(24 + 476 - resized.bottom, 468);
  assert.equal(overlay.height, resized.height);
  assert.equal(resized.bottom, 32, 'keep safety clearance without subtracting the keyboard height twice');
  assert.ok(24 + 776 - overlay.bottom - overlay.height >= 24 + 24 + 38);
});

test('Android negative window origins are normalized before comparing with keyboard screen coordinates', () => {
  const normalized = screenObservation({ rootTop: -52, composerTop: 440, android: true });
  assert.deepEqual(normalized, { top: 0, composerTop: 492, screenOffset: 52 });
  const layout = chatLayout({ rootTop: normalized.top, rootHeight: 876, keyboardTop: 535, topInset: 52 });
  assert.equal(876 - layout.bottom, 503, 'input bottom is above keyboard, not 20dp underneath it');
  assert.deepEqual(screenObservation({ rootTop: 24, composerTop: 400, android: true }), { top: 24, composerTop: 400, screenOffset: 0 });
});

test('actual composer overlap is corrected and remains stable after moving above the keyboard', () => {
  const correction = composerCorrection({ composerTop: 480, composerHeight: 64, keyboardTop: 500 });
  assert.equal(correction, 60, 'move the entire row above the keyboard with 16dp clearance');
  assert.equal(composerCorrection({ current: correction, composerTop: 420, composerHeight: 64, keyboardTop: 500 }), 60);
  assert.equal(composerCorrection({ current: correction, composerTop: 360, composerHeight: 64, keyboardTop: 500 }), 0, 'remove extra correction if Android subsequently resizes the window');
  assert.equal(composerCorrection({ composerTop: 400, composerHeight: 64, keyboardTop: 500 }), 0);
  assert.equal(composerCorrection({ current: 60, composerTop: 420, composerHeight: 64, keyboardTop: null }), 0);
});

test('chat size stays bounded in small windows and recovers after keyboard dismissal', () => {
  for (const rootHeight of [0, 100, 300, 800]) {
    const layout = chatLayout({ rootHeight, keyboardTop: 50, topInset: 24 });
    assert.ok(layout.height >= 0 && layout.height <= rootHeight);
  }
  const shown = chatLayout({ rootHeight: 800, keyboardTop: 450, topInset: 24 });
  const hidden = chatLayout({ rootHeight: 800, keyboardTop: null, topInset: 24 });
  assert.ok(shown.bottom > hidden.bottom);
  assert.equal(hidden.height, 424);
});
