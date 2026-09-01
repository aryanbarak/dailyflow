# ai/manifests/ — AI model asset manifests

Defines and demonstrates `AiModelManifest`
([`shared/aiLearning.ts`](../../shared/aiLearning.ts)) — the contract that
makes a model asset's provider, base model, and (optional) adapter
dependency explicit and independently versioned, per
[ADR-0020](../../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
Decision item 8.

## Fields

| Field | Required | Meaning |
|---|---|---|
| `providerId` | yes | Which inference provider serves this model (e.g. `'workers-ai'`, `'gemini'`) |
| `baseModelId` | yes | The base model's identifier |
| `exactBaseRevision` | when `adapterId` is set | Exact pinned revision/commit/snapshot of the base model |
| `adapterId` | no | LoRA adapter identifier, if this manifest describes a fine-tuned asset |
| `adapterVersion` | no | Adapter's own version |
| `trainingDatasetVersion` | no | Which pinned set of `AiTrainingExampleV1` rows produced this adapter |
| `evalSuiteVersion` | yes | Which version of `ai/evals/intent-routing-v1/` this asset was scored against |
| `promptContractVersion` | yes | Which prompt/schema contract version this asset expects |
| `createdAt` | yes | ISO-8601 timestamp |

**An adapter's base dependency must always be explicit.** A manifest with
`adapterId` set but no `exactBaseRevision` is invalid by construction —
`shared/aiLearning.ts`'s `collectAiModelManifestErrors` rejects it. An
adapter trained against one base-model revision silently applied to a
different revision is exactly the drift this rule exists to make
impossible to represent.

## Worked example — base model only, no adapter (current state)

```json
{
  "providerId": "workers-ai",
  "baseModelId": "UNDECIDED",
  "evalSuiteVersion": "intent-routing-v1",
  "promptContractVersion": "1",
  "createdAt": "2026-09-01T00:00:00.000Z"
}
```

Base model selection is deliberately undecided in this slice — see
`ai/training/README.md`'s own section on this. This manifest shape is
what a future benchmark run would use to record which candidate base
model it evaluated, before any of them is chosen as SmartFlow Core.

## Worked example — a hypothetical future adapter

```json
{
  "providerId": "workers-ai",
  "baseModelId": "example-base-model-7b",
  "exactBaseRevision": "sha256:0000000000000000000000000000000000000000000000000000000000000",
  "adapterId": "smartflow-intent-routing-lora",
  "adapterVersion": "0.1.0",
  "trainingDatasetVersion": "intent-routing-v1-training-2026-09-01",
  "evalSuiteVersion": "intent-routing-v1",
  "promptContractVersion": "1",
  "createdAt": "2026-09-01T00:00:00.000Z"
}
```

This is illustrative only — no such adapter exists. It demonstrates the
shape a real manifest must satisfy once one does.

## What this directory does NOT do

- Does not store or reference actual model weight files (see the root
  `.gitignore`'s `*.safetensors`/`*.gguf` entries).
- Does not declare a permanent SmartFlow Core base model (see
  `ai/training/README.md`).
