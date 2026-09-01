# ai/ — SmartFlow-owned AI learning assets

This directory holds the assets SmartFlow's future AI learning loop owns
directly (evaluation fixtures, training-data contracts/configs, and model
manifests). It exists to establish, per
[ADR-0020](../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md),
that these assets belong to SmartFlow, not to whichever inference provider
(Cloudflare Workers AI, Gemini, or any future provider) happens to serve a
model at a given time.

**Status: foundation only (Slice ALF-0).** Nothing under this directory
has any runtime authority. No code in `agent/worker/` or `src/` reads
from `ai/` today, no training has been run, and no model weights exist
here or anywhere else in this repository.

## Layout

```
ai/
  README.md              <- this file
  evals/
    intent-routing-v1/   <- the first gold evaluation fixture (EVAL DATA -- never train on it)
  training/
    README.md            <- training-data contract + LoRA harness skeleton (no training code runs yet)
  manifests/
    README.md             <- AiModelManifest contract + a worked example
```

## What never lives here

- Model weights (`*.safetensors`, `*.gguf`, training checkpoints) --
  see the root `.gitignore`. This directory versions the DESCRIPTION of a
  model asset (manifests, configs, datasets), never the asset's binary
  weights.
- Raw, unreviewed chat text. See
  [`ai/training/README.md`](training/README.md) for the privacy gate every
  real-user-derived training example must pass before it can appear here.

## Related

- [ADR-0020: AI Learning Foundation and Shadow Model Governance](../docs/decisions/adr/ADR-0020-ai-learning-foundation-and-shadow-model-governance.md)
- [shared/aiLearning.ts](../shared/aiLearning.ts) — the ledger event, payload, and manifest contracts
- [shared/aiLearningTrainingExample.ts](../shared/aiLearningTrainingExample.ts) — the training-example contract
- [shared/aiLoraTrainingConfig.ts](../shared/aiLoraTrainingConfig.ts) — the LoRA training-run config contract
- [scripts/ai-learning/](../scripts/ai-learning/) — the offline eval scorer
