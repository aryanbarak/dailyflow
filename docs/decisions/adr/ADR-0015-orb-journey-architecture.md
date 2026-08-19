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

## Consequences
+ One engine serves both session types; no physics duplication; trust
  boundary and crash fail-safes inherited for free from ADR-0014.
– A new state-machine layer (room sequencing) sits above the existing pure
  physics engine; theming requires a small design-token-driven room-config
  system that did not exist before.
