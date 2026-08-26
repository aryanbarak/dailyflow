/**
 * Defense-in-depth text scrubber applied to anything captured from the
 * Claude Code subprocess (stdout/stderr) before it is logged or returned in
 * a task report. This is a backstop, not the primary control: the primary
 * control is that the companion never places a secret into Claude's prompt
 * or environment in the first place (see claudeCodeRunner.js's minimal env).
 *
 * Patterns cover the credential shapes plausible in this environment: GitHub
 * tokens (classic/OAuth/App/fine-grained), Anthropic/OpenAI-style API keys,
 * bearer/authorization headers, and a generic long-random-token heuristic.
 */
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub PAT / OAuth / user-to-server / refresh tokens
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /sk-ant-[A-Za-z0-9\-_]{10,}/g, // Anthropic API key
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style API key
  /AIza[A-Za-z0-9\-_]{20,}/g, // Google API key
  /(authorization|bearer)\s*:?\s*[A-Za-z0-9\-._~+/]{15,}=*/gi,
];

const REDACTED = "[redacted]";

export function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/** Recursively redacts string values inside a plain JSON-shaped object. */
export function redactSecretsDeep(value) {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactSecretsDeep);
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = redactSecretsDeep(val);
    }
    return out;
  }
  return value;
}
