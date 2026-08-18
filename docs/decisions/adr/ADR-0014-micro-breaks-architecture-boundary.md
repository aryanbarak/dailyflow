# ADR-0014 — Micro Breaks Architecture Boundary

Status: Accepted (PO-approved 2026-08-18)
Date: 2026-08-18
Owners: Product Owner, Architecture
Evidence base: MB-01 repository audit, MB-00 pre-flight check

## Context

SmartFlow adds "Micro Breaks": short in-workspace break games. The existing
cursor-following orb (`src/components/smartflow/smartflow-pointer-follower.tsx`)
detaches from the pointer and becomes the game ball inside an overlay rendered
on top of the live, still-mounted workspace. First mode: Classic Pong; the five
approved modes (Classic, Focus, Reaction, Memory, Quick Math) are planned
product scope, implemented strictly one at a time.

MB-01 established: the cursor orb is an independent decorative effect, NOT part
of the ADR-0002 Flow AI identity system. This ADR does not touch ADR-0002.

## Decisions

### 1. Feature boundary
`src/features/micro-breaks/` following the `src/features/mood/` shape. The
overlay mounts in `AppLayout.tsx` as a sibling of `<SmartflowPointerFollower />`
— never as a wrapper, so workspace children are not remounted. The game never
reads or mutates workspace data, never triggers AI, automation, or writes.

### 2. Core principle
"SmartFlow does not open a game. For a short moment, SmartFlow itself becomes
the game." No separate page. Workspace stays visually present behind a subtle
dim treatment (blur is an implementation option, decided by measured
performance, especially mobile).

### 3. Overlay: bespoke, with dialog-parity checklist
Radix Dialog was evaluated but not selected: its built-in modal focus/autofocus
lifecycle does not map cleanly to the continuous pointer/canvas interaction a
game loop requires. The bespoke overlay MUST provide: immediate Esc exit,
visible close control, scroll-lock, `role="dialog"` + `aria-modal="true"` +
`aria-label`, initial focus placed inside the overlay, focus containment while
active (Tab must never reach the underlying workspace), focus restoration to
the previously focused element on close, and complete teardown of all
listeners and rAF. Exit always restores pointer-orb behavior and the untouched
workspace.

### 4. Rendering & physics
Canvas game renderer: single rAF loop, no per-frame React state, no per-frame
DOM writes (consistent with the repo's own animation pattern). Physics is
delta-time based with mandatory robustness rules:
- dt is clamped / substepped; the simulation never integrates an unbounded
  elapsed delta after tab suspension, visibility changes, or frame stalls;
- `visibilitychange → hidden` pauses the simulation AND the game timer;
- resume resets the previous-timestamp reference before integrating.
Acceptance criteria: identical game behavior at 60Hz and 120Hz; no
tunneling/teleport after a simulated 15s tab suspension.
No game-engine dependencies (no Phaser/Pixi/Three).

### 5. Orb identity: shared visual definition, two renderers
What is shared is an extracted Orb visual definition (tokens/model: core
color, glow color/radius, opacity, size, gradient stops) sourced from the
existing orb settings — NOT a shared React component:
- Pointer Orb: the existing DOM renderer, visually unchanged;
- Game Orb: drawn by the Canvas renderer from the same tokens.
Renderer handoff happens at a rest point: on entry, the DOM orb transitions to
the game start position, then the canvas takes over and the DOM orb hides; on
exit, the reverse. Visual parity between the two renderers, and a pop-free
handoff, are explicit acceptance criteria. While a break is active, the
pointer-follow loop and its window listeners are fully suspended via a
`gameActive` flag in the micro-breaks store (NOT in `appearanceStore`).

### 6. Score model (PO-approved: session log)
Append-only writes to table `micro_break_sessions`:
- `id uuid primary key` — generated CLIENT-SIDE (`crypto.randomUUID()`) at
  session end; all persistence retries reuse the same id; insert uses
  `on conflict (id) do nothing`; a duplicate means already-synced. This makes
  retry idempotent by design (recorded now, implemented in slice 4).
- `user_id uuid not null references auth.users(id) on delete cascade`
- `mode` — constrained to the approved mode set (mechanism per repo convention)
- `duration_seconds integer` — positive, within the frozen preset set
- `score integer` — `>= 0`
- `created_at timestamptz` — server default `now()`
Index: `(user_id, mode, duration_seconds, score desc)` — the best-score query.
Best score is derived: `MAX(score)` per `(mode, duration_seconds)`.
RLS — explicit, no "ALL" policy:
- SELECT: `using (auth.uid() = user_id)`
- INSERT: `with check (auth.uid() = user_id)`
- UPDATE: no policy (append-only: the app never updates rows)
- DELETE: `using (auth.uid() = user_id)` — PO-approved: user data ownership;
  "append-only" constrains the app's write pattern, not the user's right to
  erase their own data.
Rationale for session log over a per-(user,mode) aggregate row: conflict-free
cross-device sync (no counter merging), per-(mode,duration) records for free,
real usage evidence, future flexibility without extra telemetry now.

### 7. Game rule & durations
Fixed-duration timer is the only end condition (no lives). Durations are user
presets — 60 / 90 / 120 seconds, default 90. Slice 1 ships with the 90-second
default as a named constant only; the Settings UI for selecting presets is
added in slice 2. The preset SET is frozen before the persistence slice ships.
Records are comparable only within the same (mode, duration).

### 8. Trust model
Scores are client-generated, private convenience data. No anti-cheat, no
server-authoritative physics, no leaderboard, no social features. Acceptable
because no score is ever visible to another user.

### 9. Local-first persistence
Gameplay never depends on Supabase. On session end: one write attempt; on
failure or offline, the session (with its fixed client id) is held in
localStorage and retried on next app load / online event. No generalized sync
framework.

### 10. Entry points
Slice 1: a command-palette action (desktop) and a small MobileNav icon
(mobile). The orb itself remains `pointer-events: none`; making it clickable
is backlog, revisited only with a core-only hit-target design. No permanent
top-level "Games" navigation.

### 11. Design language (binding for all modes)
Vocabulary: Main Orb = player object; Target Orbs = smaller orbs of the same
light family; Trail = movement; Pulse = success; Fade = memory/disappearance;
Radial Wave = reaction event. Slice-1 minimum game feel (Definition of Done):
detach/return transition with pop-free renderer handoff, orb visual identity
via shared tokens, smooth delta-time motion, paddle-contact-point impact
angle, progressive speed with hard caps and degenerate-angle prevention,
subtle trail, impact squash, paddle glow, basic score HUD, Esc/close, mouse +
touch via Pointer Events, workspace restoration, reduced-motion behavior
(decorative effects reduced, core game intact), and i18n (en/de/fa) with
RTL-safe numeric rendering via the `bidiText.tsx` isolation pattern. Hit-stop,
if used, starts ≤30ms and is tuned by feel, never locked by number. No
engagement mechanics ever: no streaks, no notifications, no timed rewards.

### 12. Sequencing
Slice 1: Classic gameplay + entry points, no persistence, fixed 90s. Slice 2:
combo, sensory final wave (no score multiplier), duration-preset Settings UI,
full mobile/PWA acceptance, polish. Slice 3: Supabase migration + RLS +
service (Tier-1: explicit PO "برو"). Slice 4: offline queue + idempotent
retry. Mode 2+ begins only after Classic is stable and persistence is proven;
usage evidence may influence tuning and sequencing, but the five approved
modes remain planned product scope. Later/backlog: orb personality,
environment reaction (cached rects, transform/opacity only, read-only
geometry), local-only ghost run (requires its own checkpoint data — NOT
provided by `micro_break_sessions`), sound, orb-click entry.

## Consequences
+ One visual language across five modes; comparable per-(mode,duration)
  records; idempotent sync by construction; feature fully independent of the
  write layer.
– Two orb renderers must be kept visually in parity (token drift risk);
  bespoke overlay must re-prove dialog parity via tests; per-duration records
  slightly complicate best-score display logic.
