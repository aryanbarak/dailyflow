// @vitest-environment jsdom
//
// Task 38, point 11: gesture-logic proof for the custom in-app
// pull-to-refresh. jsdom has no native TouchEvent/Touch constructors, but
// @testing-library/react's fireEvent maps `touchStart`/`touchMove`/
// `touchEnd` to a plain Event with the extra init properties (touches: [...])
// assigned directly onto it -- since the hook under test only ever reads
// `event.touches[0].clientX/clientY` and `event.touches.length`, a plain
// array works exactly like a real TouchList for these purposes, with no
// polyfill needed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { usePullToRefreshGesture } from './usePullToRefreshGesture';

function touch(clientX: number, clientY: number) {
  return { touches: [{ clientX, clientY }] as unknown as Touch[] };
}

function makeContainer(scrollTop = 0) {
  const el = document.createElement('main');
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop, writable: true });
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('usePullToRefreshGesture', () => {
  it('fires onRefresh when pulled past the threshold from scrollTop 0', async () => {
    const container = makeContainer(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(100, 130)); // decides vertical-pull
    fireEvent.touchMove(container, touch(100, 220)); // deltaY=120 * 0.5 damping = 60px >= 50 threshold
    await fireEvent.touchEnd(container);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the container is not at scrollTop 0 (mid-scroll)', async () => {
    const container = makeContainer(40); // scrolled down
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(100, 130));
    fireEvent.touchMove(container, touch(100, 260)); // would clear threshold if it engaged
    await fireEvent.touchEnd(container);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does NOT fire on a horizontal swipe (deltaX dominates deltaY)', async () => {
    const container = makeContainer(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(220, 115)); // deltaX=120, deltaY=15 -- clearly horizontal
    await fireEvent.touchEnd(container);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('cancels (does not fire) when released before the threshold', async () => {
    const container = makeContainer(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(100, 130)); // decides vertical-pull
    fireEvent.touchMove(container, touch(100, 140)); // deltaY=40 * 0.5 = 20px < 50 threshold
    await fireEvent.touchEnd(container);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('disabled (enabled: false) never attaches listeners at all -- a full pull sequence is a no-op', async () => {
    const container = makeContainer(0);
    const addSpy = vi.spyOn(container, 'addEventListener');
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: false, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    expect(addSpy).not.toHaveBeenCalled();

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(100, 260));
    await fireEvent.touchEnd(container);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('cleans up all touch listeners on unmount, with no leaked handlers', () => {
    const container = makeContainer(0);
    const removeSpy = vi.spyOn(container, 'removeEventListener');
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
  });

  it('a pull that reverses back above the start point (upward) before the threshold cancels rather than firing', async () => {
    const container = makeContainer(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      usePullToRefreshGesture({ containerRef: { current: container }, enabled: true, onRefresh, thresholdPx: 50, maxPullPx: 100 }),
    );

    fireEvent.touchStart(container, touch(100, 100));
    fireEvent.touchMove(container, touch(100, 130)); // decides vertical-pull, pulling down
    fireEvent.touchMove(container, touch(100, 90)); // reversed back above the start
    await fireEvent.touchEnd(container);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
