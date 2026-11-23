import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, PixelRatio, Platform, useWindowDimensions } from 'react-native';
import { chatLayout, composerCorrection, screenObservation } from './chatLayout';

export function useChatKeyboard(topInset) {
  const window = useWindowDimensions();
  const rootRef = useRef(null), composerRef = useRef(null);
  const [observation, setObservation] = useState({ top: 0, height: window.height, composerTop: null, composerHeight: null, forBottom: null });
  const [keyboardTop, setKeyboardTop] = useState(null);
  const [correction, setCorrection] = useState(0);
  const frame = useRef(null), mounted = useRef(false), layoutRef = useRef({});
  const base = chatLayout({ rootTop: observation.top, rootHeight: observation.height, keyboardTop, topInset });
  const maximum = Math.max(0, base.height - 150);
  const applied = base.keyboardVisible ? Math.min(correction, maximum) : 0;
  const bottom = base.bottom + applied, height = Math.max(0, base.height - applied);
  layoutRef.current = { bottom, height, correction: applied };

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const requested = layoutRef.current;
      rootRef.current?.measureInWindow((_x, top, _width, rootHeight) => {
        const commit = (composerTop = null, composerHeight = null) => {
          if (!mounted.current || rootHeight <= 0) return;
          const screen = screenObservation({ rootTop: top, composerTop, android: Platform.OS === 'android' });
          const next = { top: screen.top, rawRootTop: top, screenOffset: screen.screenOffset, height: rootHeight, composerTop: screen.composerTop, composerHeight, forBottom: requested.bottom };
          setObservation(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
        };
        if (composerRef.current) composerRef.current.measureInWindow((_cx, cy, _cw, ch) => commit(cy, ch));
        else commit();
      });
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const show = event => { setKeyboardTop(event.endCoordinates?.height > 0 ? event.endCoordinates.screenY : null); setCorrection(0); measure(); };
    const hide = () => { setKeyboardTop(null); setCorrection(0); measure(); };
    const listeners = [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    if (Platform.OS === 'ios') listeners.push(Keyboard.addListener('keyboardWillChangeFrame', show), Keyboard.addListener('keyboardWillHide', hide));
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics();
      if (metrics) setKeyboardTop(metrics.screenY);
    }
    measure();
    return () => { mounted.current = false; cancelAnimationFrame(frame.current); listeners.forEach(listener => listener.remove()); };
  }, [measure]);

  useEffect(measure, [window.height, window.width, bottom, height, measure]);
  useEffect(() => {
    if (!base.keyboardVisible || observation.forBottom !== bottom) return;
    const next = composerCorrection({ current: applied, composerTop: observation.composerTop, composerHeight: observation.composerHeight, keyboardTop, maximum });
    setCorrection(previous => previous === next ? previous : next);
  }, [observation, bottom, applied, maximum, keyboardTop, base.keyboardVisible]);

  const diagnostics = useMemo(() => ({
    windowWidth: window.width, windowHeight: window.height, pixelRatio: PixelRatio.get(),
    rootTop: observation.top, rawRootTop: observation.rawRootTop ?? null, screenOffset: observation.screenOffset || 0, rootHeight: observation.height, keyboardTop,
    composerTop: observation.composerTop, composerHeight: observation.composerHeight,
    composerBottom: observation.composerTop === null ? null : observation.composerTop + observation.composerHeight,
    baseBottom: base.bottom, correction: applied, chatBottom: bottom, chatHeight: height,
  }), [window.width, window.height, observation, keyboardTop, base.bottom, applied, bottom, height]);
  return { rootRef, composerRef, onRootLayout: measure, onComposerLayout: measure, keyboardVisible: base.keyboardVisible, bottom, height, diagnostics };
}
