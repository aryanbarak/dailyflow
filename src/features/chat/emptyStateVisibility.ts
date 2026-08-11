// SmartFlow -- Flow AI visual identity (task 17b), conversation-first
// architecture: "empty conversation -> welcome card + quick-action chips;
// first message sent -> both animate out; nothing above the messages but
// the header." This is the ONE pure decision of whether that empty state
// is showing, extracted so it is independently testable (mirrors task
// 17a's chatScrollDecision.ts pattern) and so ChatPage.tsx has a single
// source of truth instead of the two slightly different ad-hoc conditions
// it used to compute separately for the old "quick actions" grid and the
// old "hero" card (the hero card's old condition never checked
// hasActiveSession at all -- a latent gap this consolidation also closes).

export interface ChatEmptyStateVisibilityInput {
  readonly hasActiveSession: boolean;
  readonly messageCount: number;
  readonly isSending: boolean;
}

export function isChatEmptyState(input: ChatEmptyStateVisibilityInput): boolean {
  return !input.hasActiveSession && input.messageCount === 0 && !input.isSending;
}
