// MB-03, Slice 2 item 5 (bounded polish): very limited particles on paddle
// hits, gone entirely under reduced motion (see tuning.ts's
// getParticleCountForMotionPreference). Pure and deterministically
// testable -- takes its randomness as an injectable function rather than
// calling Math.random() directly, so a test can assert exact output
// without mocking globals.
import { CONVERGING_PARTICLE_RING_RADIUS_PX, PARTICLE_SPEED_PX_PER_SECOND } from './tuning';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
}

export function createHitParticles(x: number, y: number, count: number, now: number, random: () => number = Math.random): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = PARTICLE_SPEED_PX_PER_SECOND * (0.5 + random() * 0.5);
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, bornAt: now });
  }
  return particles;
}

// MB-08, ADR-0015 §11 (amendment): particles that visually CONVERGE toward
// a target point over their lifetime -- the geometric inverse of
// createHitParticles' outward burst, for Orb Journey's drifting-orb
// "Absorb" (Calm) reaction. Spawns each particle at a random point on a
// ring around the target and gives it a velocity aimed back at the target,
// so as the caller ages/moves them by vx/vy*dt (exactly like
// createHitParticles' particles -- same Particle shape, same aging
// contract) they visually close in. `arrivalMs` controls how long the
// inward travel takes to look intentional -- the caller is expected to
// pass its own particle lifetime/reaction-window value, not a value
// hardcoded here.
export function createConvergingParticles(
  targetX: number,
  targetY: number,
  count: number,
  now: number,
  arrivalMs: number,
  random: () => number = Math.random,
): Particle[] {
  const particles: Particle[] = [];
  const arrivalSeconds = Math.max(arrivalMs, 1) / 1000;
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const ringRadius = CONVERGING_PARTICLE_RING_RADIUS_PX * (0.7 + random() * 0.3);
    const startX = targetX + Math.cos(angle) * ringRadius;
    const startY = targetY + Math.sin(angle) * ringRadius;
    particles.push({
      x: startX,
      y: startY,
      vx: (targetX - startX) / arrivalSeconds,
      vy: (targetY - startY) / arrivalSeconds,
      bornAt: now,
    });
  }
  return particles;
}
