// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InferredContextSection } from "./InferredContextSection";
import type { InferredProjectContextField } from "../inferredProjectContextFieldTypes";
import type { ContextDerivationTriggerResult } from "../contextDerivationTriggerClient";

afterEach(() => {
  cleanup();
});

function field(overrides: Partial<InferredProjectContextField> = {}): InferredProjectContextField {
  return {
    id: "field-1",
    ownerId: "owner-1",
    projectId: "project-1",
    runId: "run-1",
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    sourceEvidenceIds: ["ev-1"],
    modelIdentity: "gemini",
    derivationVersion: "context-derivation-v1",
    confidence: "high",
    status: "proposed",
    source: "model",
    contentFingerprint: "abc",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeService(fields: InferredProjectContextField[]) {
  return {
    listByProject: vi.fn().mockResolvedValue(fields),
    resolve: vi.fn(),
  };
}

function successResult(overrides: Partial<ContextDerivationTriggerResult & { ok: true }> = {}): ContextDerivationTriggerResult {
  return { ok: true, runId: "run-1", evidenceCount: 3, candidateCount: 2, acceptedCount: 2, droppedCount: 0, ...overrides };
}

describe("InferredContextSection -- rendering states", () => {
  it("shows a proposed field as inferred/unconfirmed with actions available", async () => {
    const service = makeService([field({ status: "proposed", source: "model" })]);
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    expect(await screen.findByText("Data loss risk")).toBeInTheDocument();
    expect(screen.getByText("Inferred -- unconfirmed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /correct/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("shows a plain-confirmed field (source=model) as Confirmed, with no actions", async () => {
    const service = makeService([field({ status: "user_confirmed", source: "model" })]);
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("shows a correction's new row (source=user, supersedesId set) as Corrected, with no actions", async () => {
    const service = makeService([field({ status: "user_confirmed", source: "user", supersedesId: "field-original" })]);
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    expect(await screen.findByText("Corrected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /correct/i })).not.toBeInTheDocument();
  });

  it("never renders a rejected field, a superseded field, or the pre-correction original model row", async () => {
    const service = makeService([
      field({ id: "rejected", status: "user_rejected" }),
      field({ id: "superseded", status: "superseded" }),
      field({ id: "original", status: "user_corrected", source: "model" }),
    ]);
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    await waitFor(() => expect(service.listByProject).toHaveBeenCalled());
    expect(screen.getByText(/No inferred objectives, milestones/)).toBeInTheDocument();
    expect(screen.queryByText("Data loss risk")).not.toBeInTheDocument();
  });

  it("groups fields by kind", async () => {
    const service = makeService([
      field({ id: "risk-1", kind: "risk", status: "proposed" }),
      field({ id: "obj-1", kind: "objective", status: "proposed", content: { summary: "Ship v1", status: "active" } }),
    ]);
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    expect(await screen.findByText("Objectives")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
  });

  it("surfaces a load failure honestly", async () => {
    const service = { listByProject: vi.fn().mockRejectedValue(new Error("boom")), resolve: vi.fn() };
    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Inferred context could not be loaded.");
  });
});

describe("InferredContextSection -- confirm/reject/correct flows", () => {
  it("confirms a field, then reloads the list and notifies the caller", async () => {
    const user = userEvent.setup();
    const service = makeService([field({ status: "proposed" })]);
    service.resolve.mockResolvedValue({ outcome: "user_confirmed", field: field({ status: "user_confirmed", source: "model" }) });
    const onContextChanged = vi.fn();

    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} onContextChanged={onContextChanged} />);
    await screen.findByText("Data loss risk");

    await user.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ fieldId: "field-1", action: "confirm" }));
    await waitFor(() => expect(service.listByProject).toHaveBeenCalledTimes(2));
    expect(onContextChanged).toHaveBeenCalled();
  });

  it("rejects a field", async () => {
    const user = userEvent.setup();
    const service = makeService([field({ status: "proposed" })]);
    service.resolve.mockResolvedValue({ outcome: "user_rejected", field: field({ status: "user_rejected" }) });

    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);
    await screen.findByText("Data loss risk");

    await user.click(screen.getByRole("button", { name: /reject/i }));

    await waitFor(() => expect(service.resolve).toHaveBeenCalledWith({ fieldId: "field-1", action: "reject" }));
  });

  it("shows a per-field error and keeps the field actionable when resolve fails", async () => {
    const user = userEvent.setup();
    const service = makeService([field({ status: "proposed" })]);
    service.resolve.mockRejectedValue(new Error("Only a still-proposed field can be resolved."));

    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);
    await screen.findByText("Data loss risk");

    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only a still-proposed field can be resolved.");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });

  it("opens the correction form pre-filled, rejects invalid input via the canonical validator, then submits valid corrected content", async () => {
    const user = userEvent.setup();
    const service = makeService([field({ status: "proposed", content: { summary: "Data loss risk", severity: "high" } })]);
    service.resolve.mockResolvedValue({
      outcome: "user_corrected",
      field: field({ id: "field-2", status: "user_confirmed", source: "user", supersedesId: "field-1" }),
    });

    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={vi.fn()} />);
    await screen.findByText("Data loss risk");

    await user.click(screen.getByRole("button", { name: /correct/i }));

    const summaryInput = await screen.findByLabelText(/Summary/);
    expect(summaryInput).toHaveValue("Data loss risk");

    // Clear the required summary field -- the canonical validator must reject this client-side, before any resolve() call.
    await user.clear(summaryInput);
    await user.click(screen.getByRole("button", { name: /submit correction/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/summary/i);
    expect(service.resolve).not.toHaveBeenCalled();

    await user.type(summaryInput, "Updated risk summary");
    await user.click(screen.getByRole("button", { name: /submit correction/i }));

    await waitFor(() =>
      expect(service.resolve).toHaveBeenCalledWith({
        fieldId: "field-1",
        action: "correct",
        correctedContent: { summary: "Updated risk summary", severity: "high" },
      }),
    );
  });
});

describe("InferredContextSection -- derivation trigger", () => {
  it("disables the derivation trigger with a visible reason for an archived project", () => {
    const service = makeService([]);
    render(<InferredContextSection projectId="project-1" archived service={service} triggerDerivation={vi.fn()} />);

    expect(screen.getByRole("button", { name: /derive from evidence/i })).toBeDisabled();
    expect(screen.getByText(/disabled because this project is archived/i)).toBeInTheDocument();
  });

  it("surfaces the zero-evidence (422) failure with a human-readable, ingestion-pointing message", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerDerivation = vi.fn().mockResolvedValue({
      ok: false,
      code: "NO_ELIGIBLE_EVIDENCE",
      message: "This project has no active evidence to derive context from yet.",
    } satisfies ContextDerivationTriggerResult);

    render(<InferredContextSection projectId="project-1" archived={false} service={service} triggerDerivation={triggerDerivation} />);
    await waitFor(() => expect(service.listByProject).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /derive from evidence/i }));

    expect(await screen.findByText("This project has no evidence yet. Add evidence before deriving context.")).toBeInTheDocument();
  });

  it("reloads the field list and notifies the caller after a successful derivation", async () => {
    const user = userEvent.setup();
    const service = makeService([]);
    const triggerDerivation = vi.fn().mockResolvedValue(successResult());
    const onContextChanged = vi.fn();

    render(
      <InferredContextSection
        projectId="project-1"
        archived={false}
        service={service}
        triggerDerivation={triggerDerivation}
        onContextChanged={onContextChanged}
      />,
    );
    await waitFor(() => expect(service.listByProject).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /derive from evidence/i }));

    await waitFor(() => expect(service.listByProject).toHaveBeenCalledTimes(2));
    expect(onContextChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Derivation complete: 2 accepted, 0 dropped\./)).toBeInTheDocument();
  });
});
