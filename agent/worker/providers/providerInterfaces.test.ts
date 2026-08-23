import { describe, expect, it } from "vitest";
import type {
  EmbeddingProvider,
  EmbeddingResult,
  StructuredGenerationProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TextGenerationProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "./types";

// ADR-0018 S0: proves the three interfaces (Decision 1) are implementable
// as written -- not wired to any real call site (that is S1/S2/S3), and no
// behavior change results from this file existing. `implements` below is
// itself the compile-time proof; the assertions just give it something to
// run under `npm test` rather than being a type-only file.

class StubTextGenerationProvider implements TextGenerationProvider {
  readonly id = "stub-text";

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    return { text: `stub reply to ${req.turns.length} turn(s)`, finishReason: "STOP" };
  }
}

class StubStructuredGenerationProvider implements StructuredGenerationProvider {
  readonly id = "stub-structured";

  async generateStructured<T>(req: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    // Deliberately never returns a "T-typed" value -- per ADR-0018
    // Decision 1's own comment, the provider only ever hands back raw
    // text; parsing/validation into a T stays the caller's job.
    return { rawText: JSON.stringify({ schemaEcho: req.schema }), finishReason: "STOP" };
  }
}

class StubEmbeddingProvider implements EmbeddingProvider {
  readonly id = "stub-embedding";
  readonly model = "stub-model";
  readonly dimensions = 768;
  readonly normalizesOutput = false;

  async embed(texts: string[]): Promise<EmbeddingResult> {
    return { vectors: texts.map(() => new Array(this.dimensions).fill(0)) };
  }
}

describe("ADR-0018 S0: provider interfaces are implementable", () => {
  it("TextGenerationProvider: a stub implementation compiles and runs", async () => {
    const provider: TextGenerationProvider = new StubTextGenerationProvider();

    const result = await provider.generateText({ turns: [{ role: "user", content: "hi" }] });

    expect(provider.id).toBe("stub-text");
    expect(result.text).toContain("1 turn(s)");
    expect(result.finishReason).toBe("STOP");
  });

  it("TextGenerationRequest accepts system/temperature/maxOutputTokens/providerOptions -- all optional per ADR-0018 Decision 2", async () => {
    const provider: TextGenerationProvider = new StubTextGenerationProvider();

    const result = await provider.generateText({
      system: "You are terse.",
      turns: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      maxOutputTokens: 128,
      temperature: 0.7,
      providerOptions: { thinkingConfig: { thinkingBudget: 0 } },
    });

    expect(result.text).toContain("2 turn(s)");
  });

  it("StructuredGenerationProvider: a stub implementation compiles and runs, including the generic type param at the call site", async () => {
    const provider: StructuredGenerationProvider = new StubStructuredGenerationProvider();

    const result = await provider.generateStructured<{ title: string }>({
      turns: [{ role: "user", content: "hi" }],
      schema: { type: "object", properties: { title: { type: "string" } } },
    });

    expect(typeof result.rawText).toBe("string");
    expect(result.rawText).toContain("schemaEcho");
    expect(result.finishReason).toBe("STOP");
  });

  it("EmbeddingProvider: a stub implementation compiles and runs, dimensions/normalizesOutput/model are real instance properties", async () => {
    const provider: EmbeddingProvider = new StubEmbeddingProvider();

    const result = await provider.embed(["a", "b"]);

    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(provider.dimensions);
    expect(provider.normalizesOutput).toBe(false);
    expect(provider.model).toBe("stub-model");
  });

  it("ProviderUnavailableError re-exports through providers/index.ts unchanged -- same class identity, no move, no rename", async () => {
    const direct = await import("../provider-errors");
    const viaBarrel = await import("./index");

    expect(viaBarrel.ProviderUnavailableError).toBe(direct.ProviderUnavailableError);
    expect(new viaBarrel.ProviderUnavailableError("test")).toBeInstanceOf(direct.ProviderUnavailableError);
  });
});
