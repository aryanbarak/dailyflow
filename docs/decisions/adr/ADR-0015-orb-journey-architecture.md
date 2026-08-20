# ADR-0015 — Orb Journey Architecture

Status: Accepted
Date: 2026-08-19
Owners: Product Owner, Architecture
Supersedes: the MB-04 "Survival mode" plan (retired, fully replaced by this
ADR). Extends ADR-0014, which remains authoritative for Quick Break / Classic
Pong, physics, rendering, orb identity, trust model, and crash/exit
fail-safes — all of which this ADR reuses unchanged.

## Context
Micro Breaks (ADR-0014) shipped as a fixed-duration break game. Product
direction has evolved: users also want an untimed, longer-form play session
("gaming while very tired, or during long idle time like travel") with real
skill progression. Rather than a sixth Pong "mode" (the previously-scoped
Survival/lives variant), this becomes a second session type with its own
identity, sharing the same engine and Orb.

## Decisions

### 1. Two session types under "Break"
- **Quick Break** (existing, unchanged): fixed timer, one field, Classic Pong.
- **Orb Journey** (new): untimed, a sequence of Rooms, ends only via Esc/close.
Both share the same physics engine, Orb visual identity, bespoke overlay
shell, and crash/exit fail-safes (ADR-0014 §3-§5). They are session *intents*
over one engine, not two products.

### 2. Room definition
A Room = fixed geometry + a clear goal + an end condition, ~15-25s to
complete. Completing a Room auto-transitions (short, reduced-motion-aware
transition, no hard reload) to the next Room.

### 3. Failure within a Room
Missing (floor contact) restarts the CURRENT room only — never the whole
Journey, never a life system. No "game over" except explicit Esc/close. This
is a deliberate reversal of the earlier "no lives" debate: Journey has no
lives BECAUSE failure only costs room-local time, not global progress.

### 4. Difficulty
Base difficulty scales with room index (room 6 is harder than room 1).
Adaptive-correction-from-recent-performance (ADR-0014-era idea) is explicitly
DEFERRED past this slice — room-index-only difficulty ships first; do not
implement recent-performance correction yet.

### 5. Room theming — abstract, never real data
Rooms borrow SmartFlow's visual language (color, iconography, card shapes)
per module family (Tasks/Calendar/Finance/Journal), sourced ONLY from design
tokens — NEVER real task titles, event data, or amounts. This preserves both
the existing "game never reads workspace data" trust boundary (ADR-0014 §1)
and the feature's own purpose: a user on a break should not see their real
overdue work. This slice ships exactly ONE theme family: Focus/Tasks-inspired
abstract shapes (checkmark-like forms, list lines, no real text).

### 6. Scope explicitly deferred (future slices, not this one)
Target-orb sequences, path branching, constellation meta-progression,
checkpoint persistence (Supabase — Tier-1, requires explicit PO "برو"),
adaptive-performance-correction difficulty. Breakable obstacles are no
longer deferred — see §10 (Amendment, post-MB-06).

### 7. This slice's content
**Amended (MB-13): room count extended to 3.** The original "exactly 2
rooms" constraint below was this slice's initial scope, not a permanent
ceiling — see §12 for Room 3's addition. The room-sequencing and
'cleared'-phase logic (§7's own text below, plus MB-05's judgment call on
cleared-phase behavior) generalizes to N rooms with no design change; only
the authored room count increases.

Exactly 2 rooms, same theme family, ricochet-only mechanics (no targets, no
breakable obstacles). Room 1 introduces the mechanic; Room 2 is a harder
variant via room-index difficulty only.

### 8. Entry point
The existing entry surfaces (command palette action, MobileNav icon) open a
lightweight in-overlay choice — "Quick Break" vs "Orb Journey" — reusing the
bespoke overlay shell, rather than duplicating entry points in the app chrome.
No persistence this slice, so "Continue Journey" is not yet meaningful; only
"New Journey" exists until the checkpoint-persistence slice ships.

### 9. Persistence
None this slice. Journey progress (room reached, score) lives only in memory
and is lost on close — identical pattern to Quick Break Slice 1. Checkpoint
persistence (room-index only, not frame state) is a separate future Tier-1
slice per the concept doc.

### 10. Breakable obstacles (Amendment, post-MB-06)
**Retired for Room 2, post-MB-08 (PO decision).** After playing Room 2 with
both the static breakable obstacle (this section) and the drifting speed-
orbs (§11) together, the PO found the static obstacle no longer added value
alongside the drifting-orb mechanic and asked for its removal. Room 2's
authored content no longer includes a breakable obstacle — see MB-09. The
engine-level capability described below is NOT removed: it remains generic,
additive infrastructure (PongObstacleConfig/PongObstacleState in
pongEngine.ts) available to any future room that wants it. The design
rationale below is kept for that future use, not as current Room 2 behavior.

Some obstacles in a room may be marked breakable. Breaking one requires a
charged hit: the existing combo counter (already built, ADR-0014-era) must
be at or above a tuning-configurable threshold at the moment of contact —
this is a skill reward, not a default interaction. On break: a stronger-than-
normal particle burst (reusing the existing particle system, ADR-0014 §11)
plays, and the obstacle is permanently removed for the remainder of that room
instance (not the whole Journey — it reappears if the room restarts after a
floor miss, consistent with §3's "failure restarts the current room").
Under prefers-reduced-motion: the obstacle is still removed on a qualifying
hit (this is gameplay, not decoration), but without the particle burst.
Scope for this slice: Room 2 only. Room 1 remains obstacle-free by design
(§7's "intro, forgiving" room). A future slice may extend this to additional
rooms once room 2's breakable obstacle is proven in real play.

### 11. Drifting speed-orbs (Amendment, post-MB-07)
**Revised, post-MB-09 playtesting (PO decision).** Real play showed the
original temporary/timed multiplier model, and the reward↔penalty speed
mapping, did not match the actual experience: increasing speed feels
exciting (a reward), not punishing. The design is revised as follows,
superseding the timed-multiplier mechanics described below (kept for
history):

- Effects are no longer temporary/timed. There is no expiry. A speed change
  from contact persists until the next such event or a room-local restart
  (which resets speed to the room's base, as always).
- Reward-role contact with the ball multiplies CURRENT ball speed by
  REWARD_SPEED_STEP (>1, tuning constant), clamped by the existing
  ADR-0014 §4 maxSpeed ceiling. Unchanged otherwise: no paddle interaction,
  a miss (ball never touches it) fades silently, no penalty.
- Penalty-role contact with the ball multiplies CURRENT ball speed by
  PENALTY_SPEED_STEP (<1, tuning constant), clamped by a NEW minSpeed floor
  (new invariant, symmetric to the existing maxSpeed ceiling — required so
  the ball cannot be driven to a near-zero, degenerate speed by repeated
  penalties).
- NEW: penalty-role orbs also interact with the paddle. If the paddle
  contacts a penalty-role orb before it reaches the ball or the bottom of
  the room, the orb is removed with NO speed change (a successful defensive
  block — neutral outcome, distinct from both the Absorb and Jolt
  reactions, needs its own minimal visual cue).
- NEW: if a penalty-role orb reaches the bottom of the room without being
  touched by the ball AND without being caught by the paddle, the same
  penalty (speedMultiplier via PENALTY_SPEED_STEP, clamped to the floor) is
  applied, with the same Jolt-style reaction, even though the triggering
  contact was not literally at the ball's position.
- The Calm/Haste naming and the PongState speedMultiplier/
  speedMultiplierExpiresAt fields from the original design are retired;
  the role field (`'reward' | 'penalty'`) and the rim-shape accessibility
  cue (smooth=reward, notched=penalty) are unchanged and remain the
  semantic/visual source of truth.

A second, distinct hazard/pickup category, additive to §10's static breakable
obstacles: small orbs (same light family as the main Orb and target orbs,
per the Design Language table) drift downward through the room at a
constant speed. Two variants, each with a distinct SEMANTIC ROLE, not just a
color:
- Calm (reward): slows the ball on contact — more breathing room.
- Haste (penalty): speeds the ball on contact — more pressure.
Reward and penalty must be distinguishable WITHOUT relying on color alone
(accessibility): Calm orbs render with a smooth, continuous rim; Haste orbs
render with a notched/dashed rim. This distinction must be visible before
contact, not just inferred from the reaction after.
On contact with the main ball (not the paddle):
- Calm: "Absorb" reaction — particles converge inward toward the Orb, a
  single smooth warm brightening pulse (reuses the existing Pulse-on-success
  language).
- Haste: "Jolt" reaction — particles burst outward (not converging), a sharp
  double-flash (bright-dim-bright) instead of a smooth glow, plus a small,
  bounded, short-duration shake of the Orb sprite.
Both apply a temporary ball-speed multiplier for a fixed duration (Calm
down, Haste up), clamped by the existing ADR-0014 §4 maxSpeed ceiling.
Effects do not stack; a new contact refreshes duration, not magnitude.
Under prefers-reduced-motion: for BOTH variants, the shake/converging-or-
bursting particle motion is reduced/suppressed, but the flash/pulse color
cue (a static appearance change, not motion) remains — so the reward-vs-
penalty distinction stays legible even with reduced motion. The rim-shape
cue (smooth vs notched) is unaffected by reduced-motion since it's not
animation.
If a drifting orb reaches the bottom of the room without being touched, it
silently fades — no penalty, no reaction; missing one (of either kind) is a
foregone opportunity/avoided risk, not a failure state.
Spawn cadence, drift speed, and the speed-multiplier magnitude/duration are
tuning-configurable constants (tuning.ts), not hardcoded. Room 1 remains
free of drifting orbs this slice, consistent with §7.

### 12. Room 3 (Rhythm/Calendar theme)
A third room is added, using the Rhythm/Calendar theme family from the
concept doc's theming table (§13 of the original concept doc): grid lines
and horizontal bar shapes, abstract, sourced from design tokens only — the
same "never real data" rule as Room 1/2's Focus/Tasks theme (§5). Difficulty
continues via the existing room-index-only scaling formula (§4) — no new
difficulty mechanism. The one Room-3-specific content lever is drifting-orb
spawn cadence, which is increased relative to Room 2 (a tuning constant, not
a new mechanic) — more frequent reward/penalty events, not new event types.
Room 3 has no static obstacles (consistent with §10's retirement — the
"obstacle" concept lives entirely in the penalty-role drifting orb, per
§11). The 'cleared' phase (§7/MB-05) now triggers after Room 3 instead of
Room 2.

### 13. Progressive play-area growth (Amendment, post-MB-13, Journey-only)
The visual width of Orb Journey's play area (the bounded region containing
the canvas and its dim/blur backdrop treatment, per ADR-0014 §2) grows with
room index, reinforcing progression without any HUD/numeric indicator. Room
1 uses the play area's current (MB-05-era) width as its baseline. Each
subsequent room's width is baseline + (roomIndex * GROWTH_STEP), a formula
—not per-room authored values—so it generalizes automatically to any future
room without additional design work, consistent with the existing room-
index difficulty formula (§4). Width is clamped at 100% of the viewport
(full-screen, dashboard no longer visible even blurred) once reached, and
stays there for any further room. Per PO direction, growth is gradual: full-
screen is reached around room 10, not sooner. This applies to Orb Journey
ONLY — Quick Break's fixed play-area size (ADR-0014 §2-§4) is unchanged.
Play-area width and gameplay difficulty (§4) are independent systems; this
section does not alter difficulty math, and difficulty does not alter play-
area sizing. The width change happens at room-transition time (not
mid-room), using the existing transition mechanism (§7/ADR-0014 §11's
detach/return and room-transition patterns) so it doesn't introduce a new
kind of jump-cut.

## Consequences
+ One engine serves both session types; no physics duplication; trust
  boundary and crash fail-safes inherited for free from ADR-0014.
– A new state-machine layer (room sequencing) sits above the existing pure
  physics engine; theming requires a small design-token-driven room-config
  system that did not exist before.
