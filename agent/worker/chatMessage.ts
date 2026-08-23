// SmartFlow -- ADR-0018 S2: ChatMessage extracted from types.ts into its
// own leaf module, re-exported from there unchanged for every existing
// importer. Reason: types.ts also defines `Env`, whose `AI: Ai` field
// references Cloudflare Workers' ambient `Ai` type (from
// @cloudflare/workers-types, a devDependency of agent/worker's own
// separate package.json -- NOT available to the root project's
// tsconfig.app.json). Importing ANYTHING from types.ts -- even a single
// unrelated type -- pulls the whole file into a compiler's graph, and a
// handful of src/*.equivalence.test.ts files deliberately reach into
// agent/worker/*-endpoint.ts for cross-implementation parity checks. Once
// providers/gemini/GeminiTextGenerationProvider.ts (ADR-0018 S1) started
// importing ChatMessage from types.ts, and S2's structured-generation
// migration added createProviders() imports to reasoning-endpoint.ts
// (reached by src/features/agent/reasoning/reasoningIntentParity.test.ts),
// that chain reached types.ts's `Ai` reference for the first time and
// broke the root typecheck gate. ChatMessage itself has zero dependency
// on Env or anything else in types.ts -- this module gives it a home
// that doesn't drag Env's Cloudflare-specific bindings along.
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  // Task 22-fix (C1 off-by-one): optional so every existing call site that
  // builds a ChatMessage without it (the Gemini-facing history array
  // doesn't need it) keeps compiling unchanged -- see flow-write-policy.ts's
  // RecentChatTurn.createdAt for why this is needed for write-intent
  // reassembly specifically.
  createdAt?: string
}
