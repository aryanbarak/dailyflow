# ENG-05 — Companion Hosting: Cloudflare Containers vs. Hetzner VPS

**Status:** Investigation only. No infrastructure provisioned, no account
created, no money spent, no code changed.
**Date:** 2026-08-26
**Prices cited:** fetched today from the sources linked inline; both
providers' pricing has moved substantially in 2026 (see §2) — re-verify
before committing money.

---

## 0. A blocker this investigation surfaced (read first)

Part 2's brief asks to "confirm the companion still only initiates outbound
polling (per ENG-04's non-negotiable constraint) ... flag if that assumption
breaks for any reason." **It breaks.** `ENG-04` does not exist anywhere in
this repository — no doc, no PROJECT_STATUS.md entry, no grep hit for
"ENG-04" or "outbound polling" at all. And the actual, real, already-built
`agent/companion/` (ENG-03) is the **opposite** of outbound-polling: it's an
HTTP **server** (`server.js`) that **listens** for inbound `POST /tasks`
requests. Nothing pulls; something pushes into it.

This matters for both candidates, not just Hetzner:

- **For Hetzner**: if the companion stays an inbound listener, it needs a
  public IP, a firewall rule, and TLS in front of it (plain HTTP would leak
  the shared token in transit) — real setup work, quantified in §3.2. If a
  future redesign makes it poll outward instead, none of that is needed.
- **For Cloudflare**: Workers are *fundamentally* inbound-request-triggered
  — a Worker doesn't run a perpetual outbound poll loop on its own. If
  "outbound-only" really is a non-negotiable future constraint, that's a
  point of friction with the Workers/Containers model too, not just Hetzner.
  A Durable Object + Alarms could implement a poll loop, but that's new
  design, not what exists today.

This investigation proceeds with **what's actually built** (inbound
listener) as the basis for both cost and effort estimates, and flags every
place the missing ENG-04 constraint would change the answer. Resolving what
ENG-04 actually says (or deciding it was never written) should happen before
either hosting choice is finalized — it changes real numbers below, not just
wording.

---

## 1. Cloudflare Containers: the pricing model, precisely

Source: [developers.cloudflare.com/containers/pricing](https://developers.cloudflare.com/containers/pricing/) (fetched today; page shows a last-updated date of 2026-04-21) and [containers/platform-details/limits](https://developers.cloudflare.com/containers/platform-details/limits/).

### 1.1 The formula

- **Base: Workers Paid plan, $5/month flat.** Required to use Containers at all; this is a floor, not a per-container fee.
- **Included monthly allowances** (pooled per account): 375 vCPU-**minutes** (=22,500 vCPU-seconds), 25 GiB-**hours** memory (=90,000 GiB-seconds), 200 GB-**hours** disk (=720,000 GB-seconds).
- **Overage rates**: $0.000020/vCPU-second, $0.0000025/GiB-second (memory), $0.00000007/GB-second (disk).
- **Billing granularity**: every 10ms the container is actively running.
- **Egress**: $0.025/GB (NA/EU, 1TB included) — irrelevant here; this workload's traffic (git clone/push of a normal web-app repo, occasional API calls) is nowhere near 1TB/month.

### 1.2 What "active" actually means — the critical, non-obvious distinction

The docs state this explicitly and it changes the whole estimate: **"CPU usage is based on active usage only," while "memory and disk usage are based on the provisioned resources for the instance type."** In plain terms: CPU is billed only for actual compute cycles (waiting on the Anthropic API — which was most of ENG-03's real 26s and 18.3s runs — is *not* CPU-active time). Memory and disk are billed for the **entire wall-clock time the container instance is alive**, at its full provisioned size, regardless of whether it's computing or idling. A workload like this one — mostly waiting on a network response, not computing — has its cost driven far more by memory/disk×wall-clock-alive-time than by CPU.

### 1.3 The second critical finding: default idle-teardown is 10 minutes

Per [containers/platform-details](https://developers.cloudflare.com/containers/platform-details/): the `Container` class's default `sleepAfter` is **10 minutes of inactivity** before Cloudflare tears the instance down. Cold start: 1–3 seconds. **If nothing in the code explicitly signals "stop now" right after a task finishes, every single task's billed wall-clock-alive-time gets padded by up to 10 minutes**, not just the ~26–30 seconds the task actually took. This is the single largest cost lever available and isn't automatic — a future Worker/Durable-Object wrapper around `agent/companion/` would need to explicitly call the stop/shutdown path after each task, not rely on the default. Both an "optimized" (explicit early stop) and "unoptimized" (default 10-min tail) scenario are modeled below so this isn't silently assumed either way.

### 1.4 Instance sizing

Cloudflare offers six predefined instance types (`lite`, `basic`, `standard-1` through `standard-4`); `standard-1` = **1/2 vCPU, 4 GiB memory, 8 GB disk** is the natural fit — comparable memory to the Hetzner plan modeled below, and generous for a workload that is one Node process + one spawned Claude Code CLI + git, none of which are memory-hungry. (No live memory/CPU profiling exists from the ENG-03 spike — this is reasoned from the process composition, not measured. `basic`, 1/4 vCPU, 1 GiB, would very likely also work and would be cheaper still; `standard-1` is used below as the safer, still-conservative choice.)

### 1.5 Real numbers: light, heavy, mixed

All scenarios use `standard-1` (4 GiB mem / 8 GB disk) and both a **pessimistic** CPU assumption (100% of wall-clock time treated as CPU-active — an explicit upper bound, since this workload is known to be I/O-bound) and a **realistic** one (CPU-active time is a much smaller fraction of wall-clock, since Claude Code spends most of its time waiting on Anthropic's API, not computing).

**Light month** — 5 tasks/day × 20 working days = 100 tasks/month, ~30s wall-clock each (matches ENG-03's real 26–39s runs):

| Scenario | Alive-time/month | Memory (GiB-sec) | Disk (GB-sec) | CPU (pess./realistic, sec) | Overage cost |
|---|---|---|---|---|---|
| **Optimized** (explicit stop after each task) | 100×30s = 3,000s (50 min) | 12,000 | 24,000 | 3,000 / ~510 | all under included allowances → **$0** |
| **Unoptimized** (default 10-min sleepAfter tail) | 100×600s = 60,000s (16.7 hr) | 240,000 | 480,000 | 60,000\* / 3,000\*\* | mem overage: (240,000−90,000)×$0.0000025=**$0.375**; disk & CPU still $0 |

\*Padding is *idle* time, not compute — CPU-active seconds stay tied to actual work (~3,000s pessimistic / ~510s realistic) regardless of how long the container idles; only memory/disk pick up the padding.

**→ Light month total: $5.00 (optimized) to ~$5.38 (unoptimized, worst case). Either way, effectively the flat base-plan price.**

**Heavy scenarios** — modeled as one long continuous 4-hour session per "heavy day" (14,400s alive-time), per the PO's own framing:

| Heavy days/month | Memory overage | Disk overage | CPU overage (pessimistic) | CPU overage (realistic, ~40% active) | **Total (pess.)** | **Total (realistic)** |
|---|---|---|---|---|---|---|
| 1 (one occasional bad day) | $0 (57,600 < 90,000) | $0 | $0 | $0 | **$5.00** | **$5.00** |
| 2 | $0.063 | $0 | $0.126 | $0 | $5.19 | $5.06 |
| 4 | $0.351 | $0 | $0.702 | $0.011 | $6.05 | $5.36 |
| 5 | $0.495 | $0 | $0.990 | $0.126 | $6.49 | $5.62 |
| 8 | $0.927 | $0.014 | $2.16 | $0.472 | $8.57 | $6.41 |
| **20 (every working day is "heavy" — extreme ceiling)** | $2.66 | $0.11 | $5.31 | $1.85 | **$13.08** | **$9.62** |

**→ A single occasional heavy day costs nothing extra ($5.00 flat) — the monthly allowance absorbs it.** Repeated heavy days compound, but even the absolute ceiling (every working day is a 4-hour session) tops out at **$9.62–$13.08/month**, not an unbounded number — Cloudflare's metering is variable but not literally unpredictable; it has a computable shape.

**Realistic mixed month** — based on this project's own actual cadence (see §4 for the evidence): real, end-to-end Claude-Code-executing runs happened only a handful of times across several working sessions (ENG-02: 2 runs; ENG-03: 1 real-repo run), not daily and not continuously. Modeling a generous version of that pattern — **10 active days/month, 3 tasks/day, ~35s each**:

- Alive-time (optimized): 10×3×35s = 1,050s → trivially within allowances → **$0 overage**.
- Alive-time (unoptimized, 10-min padding): 10×3×600s = 18,000s → memory 72,000 GiB-sec (< 90,000 included), disk 144,000 GB-sec (< 720,000), CPU 18,000s pessimistic (< 22,500) → **still $0 overage**.

**→ Realistic mixed month: $5.00/month flat, in both the optimized and unoptimized cases.**

---

## 2. Hetzner VPS: real cost and real build effort

### 2.1 Current pricing (2026 has seen large, real increases — verified from Hetzner's own docs, not just third-party blogs)

Per [docs.hetzner.com's official price-adjustment page](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), Hetzner raised cloud pricing again on **15 June 2026** (the second increase in 2026), with jumps as large as +169–192% on some lines (e.g., CPX/CCX). Cross-referenced against current aggregator data (Northflank, byteiota, comparedge — all citing the same June 2026 list) for the plan actually relevant here:

- **CX23** (renamed from CX22 in the same restructuring; x86, shared vCPU): **2 vCPU, 4 GB RAM, 40 GB disk, 20 TB included traffic — €5.49/month** (≈ **$6.41/month** at today's EUR/USD rate of 1.167).
- CAX11 (ARM/Ampere, same specs): €5.99/month (≈$6.99) — now *more* expensive than the x86 equivalent post-increase, a reversal from Hetzner's older pricing. Also carries integration risk: unconfirmed whether the `claude` CLI binary has a supported arm64 Linux build, so CX23 (x86) is the safer pick, not just the currently-cheaper one.

This is comfortably sufficient for the workload: one Node process + one spawned Claude CLI + git, which is a fraction of 4 GB RAM / 40 GB disk, and 20 TB of traffic is not reachable by this workload's actual usage by orders of magnitude.

### 2.2 Fixed price, but not zero variable risk

Per current 2026 aggregator pricing (Hetzner's own page didn't render exact figures for these line items in a direct fetch; treat as consistent-but-secondary-sourced, confirm at checkout):

- **Backups**: +20% of instance price (€5.49 → €6.59/month) if enabled. **Likely unnecessary here** — the only state on the box is a disposable git clone, trivially recreatable from GitHub; there's no unique data to protect.
- **Additional/primary IPv4**: ~€0.50/month surcharge (industry-wide IPv4 scarcity pricing most providers now apply).
- **Bandwidth overage**: ~€1/TB beyond the 20 TB included — not reachable by this workload.

**→ Realistic Hetzner cost: €5.49/month (~$6.41) flat, identical whether the month was light, heavy, or mixed** — this is the entire point of a fixed-price VPS, and it holds up under real numbers, not just in principle.

### 2.3 What has to be built (Cloudflare gives this for free/managed)

| Concern | Effort |
|---|---|
| OS provisioning | One-time: pick an Ubuntu/Debian image at creation. Trivial (~5 min). |
| OS patching/security updates | Ongoing: `unattended-upgrades` config (one-time ~15 min setup), occasional manual reboot for kernel updates (~5 min every few months). Not automatic like Cloudflare's managed platform. |
| Process supervision | One-time: a systemd unit (`Restart=always`) for `node src/index.js`. ~20–30 min, since `agent/companion/` already exists unmodified as the thing being supervised. |
| Network exposure | **Depends entirely on §0's unresolved question.** If the companion stays an inbound listener (as actually built): needs a firewall rule (Hetzner Cloud Firewall is free) restricting the port, **plus TLS** — the current `server.js` is plain HTTP, and exposing the existing shared-token auth over plain HTTP to the public internet would leak the token in transit. TLS means either a reverse proxy (Caddy auto-TLS is simplest, ~1–1.5 hr first time including DNS) or switching auth to mTLS/a VPN tunnel. If a future redesign makes the companion poll outward instead: **none of this is needed at all** — no inbound port, no TLS, no firewall exposure. |
| SSH hardening | One-time: key-only auth, disable password login, optionally `fail2ban`. ~20–30 min. |
| Backups | Likely skippable (§2.2) — no unique state. |
| Monitoring/alerting | One-time: point a free external monitor (UptimeRobot/healthchecks.io free tier) at a health endpoint. ~30–45 min. $0 ongoing (free tier). |

**One-time setup, inbound-listener scenario (as actually built today): ~3–5 hours.**
**One-time setup, if redesigned to outbound-polling: ~1.5–2.5 hours** (skips firewall + TLS entirely).

**Ongoing monthly maintenance (PO's hours, not money):** realistically **~30–45 minutes/month** once set up — OS patches, occasional CLI/dependency version bumps, monitoring-alert triage (usually $0 unless something actually breaks, in which case there's no managed recovery the way Cloudflare's platform provides).

---

## 3. Direct comparison

| | Cloudflare Containers | Hetzner VPS (CX23) |
|---|---|---|
| Light-month cost | $5.00–$5.38 | $6.41 (flat) |
| Realistic mixed-month cost | $5.00 | $6.41 (flat) |
| Heavy-month cost (1 occasional 4hr day) | $5.00 | $6.41 (flat) |
| Heavy-month cost (extreme ceiling: every day 4hrs) | $9.62–$13.08 | $6.41 (flat) |
| One-time build effort | Low-moderate: Dockerfile + a Worker/Durable-Object wrapper to start/stop the container and route requests to it — genuinely new glue code, not zero, even though the platform itself is managed. | ~3–5 hrs (inbound, as built) or ~1.5–2.5 hrs (if outbound-polling) — none of it exists yet either. |
| Ongoing maintenance effort | Near-zero — OS/patching/process-supervision are Cloudflare's problem. | ~30–45 min/month, PO's own time, no managed recovery. |
| Integration effort with existing `agent/companion/` code | **Not zero-effort despite being the same vendor as SmartFlow.** The companion's core logic (`git.js`, `taskRunner.js`, `verify.js`, etc.) is Node-stdlib-only and would run inside a container image largely unchanged — but a new Worker+Durable-Object layer to own the container's lifecycle has to be written; it doesn't exist today. | **Lower.** `agent/companion/` already runs unmodified as a plain Node process; deploying to Hetzner is `git clone`, `node src/index.js` under systemd — no new architectural layer required. |
| Matches existing SmartFlow stack | Yes — same platform/billing/account as `agent/worker/`. | No — a second, unrelated piece of infrastructure with its own operational model. |
| Learning/career value | Cloudflare Workers/Containers edge-compute skills, directly reusable on SmartFlow's own stack. | Traditional Linux/systemd/VPS ops — widely transferable, provider-agnostic DevOps skill. (No prior session context found narrowing which the PO specifically meant — both are named here rather than assumed.) |

---

## 4. Evidence for "realistic usage pattern" (this session's own cadence)

Across this project's ENG-01 through ENG-05 tasks, the number of times an actual coding-agent process ran end-to-end against a real repository was small and clustered: **2 real runs in ENG-02** (one Claude Code, one local-model spike, back-to-back in one sitting) and **1 real run in ENG-03** (one real-repo task). That's 3 genuine executions across what amounts to several hours of investigative work spread over multiple distinct working sessions — not daily, and never continuous for more than about 40 seconds at a stretch. This is the concrete basis for §1.5's "10 active days/month, 3 tasks/day" mixed-month model; it is deliberately generous relative to what's actually been observed so far.

## 5. Recommendation

**The crossover point, with the math shown:** using the realistic (not pessimistic) CPU assumption, Cloudflare's metered cost matches Hetzner's flat €5.49/$6.41 at roughly **8 heavy 4-hour days/month (~32 hours/month of genuinely continuous, saturated active use)**. Under the pessimistic assumption (100% CPU-active, the true worst case), that crossover comes sooner, at roughly **5 heavy days/month (~20 hours/month)**. Below that range, Cloudflare is cheaper — often free-equivalent, since it's absorbed by the base plan; above it, Hetzner's flat price wins and the gap only grows, since Cloudflare has no ceiling and Hetzner's is fixed by definition.

Given §4's evidence — this project's actual usage has been bursty, sub-minute-per-task, and nowhere near even one continuous 4-hour session, let alone 5–8 of them in a month — **the honest conclusion is a hybrid, not a single winner**:

- **Start on Cloudflare Containers.** At the demonstrated usage pattern, it costs the flat $5/month base plan with $0 in real overage under every modeled scenario except the extreme "every day is heavy" ceiling, which isn't remotely what's been observed. It also avoids building and maintaining a second, unrelated piece of infrastructure (§3), and keeps the companion on the same platform as the rest of SmartFlow.
- **Revisit Hetzner only if a concrete, observed threshold is crossed** — not preemptively. A clean, checkable trigger: *if any single month's actual Cloudflare bill exceeds ~$8–9 (i.e., usage is trending toward the ~20–32 hour/month crossover zone), or if a pattern of several heavy days per month becomes the norm rather than the exception, migrate to Hetzner.* Because `agent/companion/`'s core logic is plain Node with zero Cloudflare-specific dependencies, that migration is a redeploy, not a rewrite — the crossover decision doesn't need to be made now, and delaying it costs nothing.
- **Resolve §0 before building either one.** Whether the companion is meant to be an inbound listener or an outbound poller changes Hetzner's build effort by roughly 2x (TLS+firewall vs. none) and is a real open design question for Cloudflare too (Workers don't natively run a poll loop). This should be answered — by locating what ENG-04 actually specified, or by making a fresh decision if it was never written — before either hosting path is implemented.

## References

- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/pricing/) (fetched today; page dated 2026-04-21)
- [Cloudflare Containers platform details / limits](https://developers.cloudflare.com/containers/platform-details/)
- [Hetzner Cloud price adjustment, 15 June 2026 (official)](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- Hetzner CX23/CAX11 current pricing cross-referenced via [Northflank](https://northflank.com/blog/hetzner-cloud-price-adjustment) / [byteiota](https://byteiota.com/hetzner-june-2026-price-shock/) / [comparedge](https://comparedge.com/tools/hetzner/pricing) (secondary sources aggregating the same official June 2026 list — recommend confirming exact current figures at checkout)
- EUR/USD rate ≈1.167, per live search today
- ENG-03 (companion implementation + real-repo spike): delivered as an inline A–M report, not a saved doc — no `eng-03-*.md` file exists in this folder. Referenced here from that report's own numbers (26s wall clock, $0.1314 cost, one file changed) for resource-footprint reasoning and actual spike timings.
- [ENG-02: Pluggable Coding Agents Spike](eng-02-pluggable-coding-agents-spike-v1.md) (referenced for §4's usage-cadence evidence)
