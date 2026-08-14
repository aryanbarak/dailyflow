// Task 21-fix6: getPending() used to filter `.gte('trigger_at', now)`,
// which excludes exactly the alarms whose trigger_at has already passed
// -- the set useAlarms.ts's checkAndFire (`alarm.triggerAt <= now`) needs
// to see every poll. With 60s polling, a trigger_at essentially never
// lands in the query's own instant, so no alarm (task or calendar_event)
// ever fired. This is the regression guard for that fix.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authGetUser, fromMock } = vi.hoisted(() => ({
  authGetUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })),
  fromMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getUser: authGetUser }, from: fromMock },
}));

import { alarmService } from './alarmService';

describe('alarmService.getPending', () => {
  beforeEach(() => {
    // fromMock/authGetUser are hoisted (shared across every test in this
    // file) -- clear call history between tests so `.not.toHaveBeenCalled()`
    // below reflects THIS test's calls only, not every prior test's too.
    fromMock.mockClear();
    authGetUser.mockClear();
  });

  it('returns an overdue, not-fired, not-dismissed alarm (no trigger_at filter in the chain)', async () => {
    const order = vi.fn(async () => ({
      data: [{
        id: 'alarm-1',
        source_type: 'task',
        source_id: 'task-1',
        source_title: 'Overdue reminder',
        trigger_at: '2020-01-01T00:00:00.000Z',
        remind_before_minutes: 0,
        is_fired: false,
        is_dismissed: false,
      }],
      error: null,
    }));
    // Deliberately exposes ONLY `order` after the third `.eq()` -- no
    // `.gte`. If getPending() is ever changed to call `.gte('trigger_at', ...)`
    // again, that call throws (not a function) instead of silently
    // filtering the overdue alarm back out.
    const eqDismissed = vi.fn(() => ({ order }));
    const eqFired = vi.fn(() => ({ eq: eqDismissed }));
    const eqUserId = vi.fn(() => ({ eq: eqFired }));
    const select = vi.fn(() => ({ eq: eqUserId }));
    fromMock.mockReturnValue({ select });

    const result = await alarmService.getPending();

    expect(fromMock).toHaveBeenCalledWith('alarms');
    expect(eqUserId).toHaveBeenCalledWith('user_id', 'user-1');
    expect(eqFired).toHaveBeenCalledWith('is_fired', false);
    expect(eqDismissed).toHaveBeenCalledWith('is_dismissed', false);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'alarm-1', sourceTitle: 'Overdue reminder', triggerAt: '2020-01-01T00:00:00.000Z' });
  });

  it('returns an empty array when unauthenticated, without querying alarms', async () => {
    authGetUser.mockResolvedValueOnce({ data: { user: null } });

    const result = await alarmService.getPending();

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
