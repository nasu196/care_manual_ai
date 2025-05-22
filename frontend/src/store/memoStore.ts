import { create } from 'zustand';

interface NewMemoRequest {
  title: string;
  content: string; // Markdown content from chat
}

interface MemoStoreState {
  newMemoRequest: NewMemoRequest | null;
  setNewMemoRequest: (request: NewMemoRequest | null) => void;
  clearNewMemoRequest: () => void; // リクエストをクリアする関数を追加
}

export const useMemoStore = create<MemoStoreState>((set) => ({
  newMemoRequest: null,
  setNewMemoRequest: (request) => set({ newMemoRequest: request }),
  clearNewMemoRequest: () => set({ newMemoRequest: null }), // クリア関数の実装
})); 