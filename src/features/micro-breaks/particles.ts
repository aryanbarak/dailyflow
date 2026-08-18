// MB-03, Slice 2 item 5 (bounded polish): very limited particles on paddle
// hits, gone entirely under reduced motion (see tuning.ts's
// getParticleCountForMotionPreference). Pure and deterministically
// testable -- takes its randomness as an injectable function rather than
// calling Math.random() directly, so a test can assert exact output
// without mocking globals.
import { PARTICLE_SPEED_PX_PER_SECOND } from './tuning';

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
