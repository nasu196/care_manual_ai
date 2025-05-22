import { create } from 'zustand';

interface NewMemoRequest {
  title: string;
  content: string; // Markdown content from chat
}

interface MemoStoreState {
  newMemoRequest: NewMemoRequest | null;
  setNewMemoRequest: (request: NewMemoRequest | null) => void;
  clearNewMemoRequest: () => void; // リクエストをクリアする関数を追加
  memoListLastUpdated: number; // ★ 追加: メモリストの最終更新タイムスタンプ
  triggerMemoListRefresh: () => void; // ★ 追加: リスト更新をトリガーする関数
}

export const useMemoStore = create<MemoStoreState>((set) => ({
  newMemoRequest: null,
  setNewMemoRequest: (request) => set({ newMemoRequest: request }),
  clearNewMemoRequest: () => set({ newMemoRequest: null }), // クリア関数の実装
  memoListLastUpdated: Date.now(), // ★ 初期値を設定
  triggerMemoListRefresh: () => set({ memoListLastUpdated: Date.now() }), // ★ 実装
})); 