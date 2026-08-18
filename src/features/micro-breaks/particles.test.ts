import { describe, expect, it } from 'vitest';
import { getParticleCountForMotionPreference, PARTICLE_COUNT_PER_HIT, PARTICLE_SPEED_PX_PER_SECOND } from './tuning';
import { createHitParticles } from './particles';

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

describe('getParticleCountForMotionPreference (ADR-0014 §11 reduced-motion rule)', () => {
  it('returns the full tuned particle count when motion is not reduced', () => {
    expect(getParticleCountForMotionPreference(false)).toBe(PARTICLE_COUNT_PER_HIT);
  });

  it('returns exactly zero under reduced motion -- never "fewer," always none', () => {
    expect(getParticleCountForMotionPreference(true)).toBe(0);
  });
});
