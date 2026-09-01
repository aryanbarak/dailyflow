// ALF-1A (ADR-0021): deterministic, server-owned shadow sampling.
//
// WHY NOT Math.random(): sampling must be STABLE for a given source
// message -- the same turn must always produce the same sampling decision
// (section 13's own requirement), which a random source cannot guarantee
// across retries/replays/re-evaluation. Bucketing on the durable
// source-message identity instead (never on time, never on a counter)
// means "was this turn sampled for shadow" is itself a pure, reproducible
// function -- useful for later auditing which turns were eligible without
// having recorded a separate flag.
//
// NOT CRYPTOGRAPHIC: no security property is needed here -- this only
// needs to spread source-message ids roughly uniformly across [0, 1) for
// bucketing purposes, not to resist any adversarial input.

function djb2Hash(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    // `hash * 33 + charCode`, kept in 32-bit unsigned range via `>>> 0`
    // every iteration so this stays a plain JS number throughout (no
    // BigInt needed) and never accumulates a value JS can't represent
    // exactly.
    hash = ((hash * 33) + value.charCodeAt(i)) >>> 0
  }
  return hash
}

// djb2 alone diffuses poorly for inputs that differ only in a short
// trailing suffix (e.g. `source-message-0` vs `source-message-1` vs
// `...-199` -- exactly the shape of many real UUIDs' varying segments) --
// observed empirically as badly clustered sampling decisions across such
// inputs. MurmurHash3's 32-bit finalizer ("fmix32", a well-known,
// public-domain bit-avalanche mix) is applied on top of the raw hash so
// every output bit depends on the whole input, regardless of where two
// inputs happen to differ.
function fmix32(input: number): number {
  let h = input
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

// Maps `value` deterministically to a fraction in [0, 1).
function deterministicUnitFraction(value: string): number {
  const MAX_UINT32 = 0xFFFFFFFF
  return fmix32(djb2Hash(value)) / (MAX_UINT32 + 1)
}

// rate 0 -> never; rate 1 -> always; 0 < rate < 1 -> a stable hash-bucket
// decision that is IDENTICAL every time this is called with the same
// sourceMessageId and rate (no hidden state, no clock, no counter).
export function isSampledForShadow(sourceMessageId: string, sampleRate: number): boolean {
  if (sampleRate <= 0) return false
  if (sampleRate >= 1) return true
  return deterministicUnitFraction(sourceMessageId) < sampleRate
}
