import { describe, expect, it } from 'vitest';
import { getParticleCountForMotionPreference, PARTICLE_COUNT_PER_HIT, PARTICLE_SPEED_PX_PER_SECOND } from './tuning';
import { createConvergingParticles, createHitParticles } from './particles';

describe('createHitParticles', () => {
  it('spawns exactly `count` particles, all starting at the given position', () => {
    const particles = createHitParticles(120, 340, 6, 1000, () => 0.5);
    expect(particles).toHaveLength(6);
    particles.forEach(particle => {
      expect(particle.x).toBe(120);
      expect(particle.y).toBe(340);
      expect(particle.bornAt).toBe(1000);
    });
  });

  it('spawns zero particles when count is 0 (the reduced-motion case)', () => {
    expect(createHitParticles(0, 0, 0, 0)).toEqual([]);
  });

  it('is deterministic for an injected random function (no hidden Math.random dependency)', () => {
    let calls = 0;
    const fixedRandom = () => {
      calls += 1;
      return 0.25;
    };
    const a = createHitParticles(0, 0, 3, 0, fixedRandom);
    calls = 0;
    const b = createHitParticles(0, 0, 3, 0, fixedRandom);
    expect(a).toEqual(b);
    expect(calls).toBeGreaterThan(0);
  });

  it('velocity magnitude stays within the tuned speed range (0.5x-1x PARTICLE_SPEED_PX_PER_SECOND)', () => {
    const particles = createHitParticles(0, 0, 20, 0, Math.random);
    particles.forEach(particle => {
      const speed = Math.hypot(particle.vx, particle.vy);
      expect(speed).toBeGreaterThanOrEqual(PARTICLE_SPEED_PX_PER_SECOND * 0.5 - 1e-6);
      expect(speed).toBeLessThanOrEqual(PARTICLE_SPEED_PX_PER_SECOND + 1e-6);
    });
  });
});

describe('createConvergingParticles (MB-08, ADR-0015 §11 amendment -- Orb Journey drifting-orb "Absorb" reaction)', () => {
  it('spawns exactly `count` particles, each starting AWAY from the target (not at it) with velocity aimed BACK at the target -- the geometric inverse of createHitParticles', () => {
    const particles = createConvergingParticles(200, 300, 5, 1000, 260, () => 0.5);
    expect(particles).toHaveLength(5);
    particles.forEach(particle => {
      const startDistance = Math.hypot(particle.x - 200, particle.y - 300);
      expect(startDistance).toBeGreaterThan(0); // NOT spawned at the target
      expect(particle.bornAt).toBe(1000);

      // Simulate a small time step forward the same way the caller does
      // (particle.x += vx*dt) and confirm the particle gets CLOSER to the
      // target, not farther -- proves convergence, not a random drift.
      const dt = 0.05;
      const nextX = particle.x + particle.vx * dt;
      const nextY = particle.y + particle.vy * dt;
      const nextDistance = Math.hypot(nextX - 200, nextY - 300);
      expect(nextDistance).toBeLessThan(startDistance);
    });
  });

  it('spawns zero particles when count is 0 (the reduced-motion case)', () => {
    expect(createConvergingParticles(0, 0, 0, 0, 260)).toEqual([]);
  });

  it('is deterministic for an injected random function (no hidden Math.random dependency)', () => {
    const fixedRandom = () => 0.3;
    const a = createConvergingParticles(100, 100, 4, 0, 260, fixedRandom);
    const b = createConvergingParticles(100, 100, 4, 0, 260, fixedRandom);
    expect(a).toEqual(b);
  });

  it('arrives at (very near) the target after exactly arrivalMs of simulated motion', () => {
    const arrivalMs = 260;
    const particles = createConvergingParticles(150, 150, 3, 0, arrivalMs, () => 0.1);
    const dt = arrivalMs / 1000;
    particles.forEach(particle => {
      const arrivedX = particle.x + particle.vx * dt;
      const arrivedY = particle.y + particle.vy * dt;
      expect(arrivedX).toBeCloseTo(150, 5);
      expect(arrivedY).toBeCloseTo(150, 5);
    });
  });
});

describe('getParticleCountForMotionPreference (ADR-0014 §11 reduced-motion rule)', () => {
  it('returns the full tuned particle count when motion is not reduced', () => {
    expect(getParticleCountForMotionPreference(false)).toBe(PARTICLE_COUNT_PER_HIT);
  });

  it('returns exactly zero under reduced motion -- never "fewer," always none', () => {
    expect(getParticleCountForMotionPreference(true)).toBe(0);
  });
});
