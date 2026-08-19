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
Breakable obstacles, target-orb sequences, path branching, constellation
meta-progression, checkpoint persistence (Supabase — Tier-1, requires
explicit PO "برو"), adaptive-performance-correction difficulty.

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

## Consequences
+ One engine serves both session types; no physics duplication; trust
  boundary and crash fail-safes inherited for free from ADR-0014.
– A new state-machine layer (room sequencing) sits above the existing pure
  physics engine; theming requires a small design-token-driven room-config
  system that did not exist before.
