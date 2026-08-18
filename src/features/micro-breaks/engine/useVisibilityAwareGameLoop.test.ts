// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useVisibilityAwareGameLoop } from './useVisibilityAwareGameLoop';

function mockRaf() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    nextId += 1;
    callbacks.set(nextId, cb);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    callbacks.delete(handle);
  });
  return {
    flush(timestamp: number) {
      const pending = Array.from(callbacks.entries());
      callbacks.clear();
      pending.forEach(([, cb]) => cb(timestamp));
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('useVisibilityAwareGameLoop', () => {
  it('calls onTick with the frame delta on each animation frame while active (first frame only establishes the baseline)', () => {
    const raf = mockRaf();
    const onTick = vi.fn();
    renderHook(() => useVisibilityAwareGameLoop({ active: true, onTick }));

    raf.flush(1000);
    expect(onTick).not.toHaveBeenCalled();

    raf.flush(1016);
    expect(onTick).toHaveBeenCalledWith(16);
  });

  it('inactive (active: false) never starts an rAF loop at all', () => {
    const raf = mockRaf();
    const onTick = vi.fn();
    renderHook(() => useVisibilityAwareGameLoop({ active: false, onTick }));
    expect(raf.pendingCount()).toBe(0);
  });

  it('visibilitychange -> hidden cancels the rAF loop; no further onTick calls happen while hidden', () => {
    const raf = mockRaf();
    const onTick = vi.fn();
    renderHook(() => useVisibilityAwareGameLoop({ active: true, onTick }));
    raf.flush(1000);

    setDocumentHidden(true);
    expect(raf.pendingCount()).toBe(0);

    raf.flush(2000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('resume after hidden resets the previous-timestamp reference: the first post-resume frame never integrates the real-clock gap', () => {
    const raf = mockRaf();
    const onTick = vi.fn();
    renderHook(() => useVisibilityAwareGameLoop({ active: true, onTick }));
    raf.flush(1000);
    raf.flush(1016);
    expect(onTick).toHaveBeenCalledWith(16);
    onTick.mockClear();

    setDocumentHidden(true); // simulated tab suspension
    setDocumentHidden(false); // resume, real clock has jumped ~15s

    raf.flush(16000); // first post-resume frame: baseline only, no tick
    expect(onTick).not.toHaveBeenCalled();

    raf.flush(16016); // second post-resume frame: a normal 16ms delta again
    expect(onTick).toHaveBeenCalledWith(16);
  });

  it('unmount cancels the pending rAF and removes the visibilitychange listener', () => {
    const raf = mockRaf();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const onTick = vi.fn();
    const { unmount } = renderHook(() => useVisibilityAwareGameLoop({ active: true, onTick }));
    raf.flush(1000);
    expect(raf.pendingCount()).toBe(1);

    unmount();
    expect(raf.pendingCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('onVisibilityChange is notified so a caller can pause the game timer alongside physics', () => {
    mockRaf();
    const onTick = vi.fn();
    const onVisibilityChange = vi.fn();
    renderHook(() => useVisibilityAwareGameLoop({ active: true, onTick, onVisibilityChange }));

    setDocumentHidden(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(true);

    setDocumentHidden(false);
    expect(onVisibilityChange).toHaveBeenCalledWith(false);
  });
});
