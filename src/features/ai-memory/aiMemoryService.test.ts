// ADR-0010 Q3 (Product Owner amendment): user_context's write-freeze is
// COMPLETE. This is the regression guard for that removal -- a future edit
// that reintroduces `set`/`autoDetectAndSave` (even unreachable from any UI)
// would still reopen a write path this decision closed; this test fails
// loudly if either reappears on the exported service object.

import { describe, expect, it, vi } from "vitest";

const { authGetUser, fromMock } = vi.hoisted(() => ({
  authGetUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })),
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: authGetUser },
    from: fromMock,
  },
}));

import { aiMemoryService } from "./aiMemoryService";

describe("aiMemoryService -- ADR-0010 Q3 complete write-freeze", () => {
  it("has no `set` method -- the manual-write path is removed, not merely unreachable", () => {
    expect("set" in aiMemoryService).toBe(false);
  });

  it("has no `autoDetectAndSave` method -- the auto-write path is removed, not merely unreachable", () => {
    expect("autoDetectAndSave" in aiMemoryService).toBe(false);
  });

  it("still exposes a working `delete` (erasure remains, per ADR-0010 Q3's own text)", async () => {
    const eqUserId = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const deleteFn = vi.fn(() => ({ eq: eqUserId }));
    fromMock.mockReturnValue({ delete: deleteFn });

    await aiMemoryService.delete("goal_primary");

    expect(fromMock).toHaveBeenCalledWith("user_context");
    expect(deleteFn).toHaveBeenCalled();
  });

  it("still exposes a working `getAll` (read remains, per ADR-0010 Q3's own text)", async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ select });

    const result = await aiMemoryService.getAll();

    expect(fromMock).toHaveBeenCalledWith("user_context");
    expect(result).toEqual([]);
  });
});
