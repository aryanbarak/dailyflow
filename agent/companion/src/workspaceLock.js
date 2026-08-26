/**
 * Per-repository in-memory lock. Node is single-threaded for this
 * synchronous check-and-set, so there is no race window between checking
 * and setting the lock, even under concurrent async requests.
 *
 * v0 scope: reject concurrent tasks for the same repo outright (fail
 * closed / "denied", not queued). A later version could serialize via a
 * queue instead; rejecting is simpler to reason about and to test.
 */
export class WorkspaceLockRegistry {
  constructor() {
    /** @type {Set<string>} */
    this._locked = new Set();
  }

  /**
   * @param {string} repo
   * @returns {{ok: true, release: () => void} | {ok: false}}
   */
  acquire(repo) {
    if (this._locked.has(repo)) {
      return { ok: false };
    }
    this._locked.add(repo);
    return {
      ok: true,
      release: () => {
        this._locked.delete(repo);
      },
    };
  }

  isLocked(repo) {
    return this._locked.has(repo);
  }
}
