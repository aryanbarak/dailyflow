import { create } from "zustand";

// PO decision (2026-09-05, DeepSeek-style history): the conversations
// panel on Home is toggled from the app icon rail (Sidebar.tsx), OUTSIDE
// the chat tree -- so its open state lives in this tiny shared store
// rather than in ChatPage's local state. Docked panel, not a modal: it
// stays open until the user toggles it off (no auto-close on select or
// outside click). Session-local, deliberately not persisted.
interface ConversationsPanelState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useConversationsPanelStore = create<ConversationsPanelState>((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
  setOpen: (open) => set({ open }),
}));
