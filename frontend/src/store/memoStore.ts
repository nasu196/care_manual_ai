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
  isMemoViewExpanded: boolean; // ★ 追加: メモ表示・編集中かどうか
  setMemoViewExpanded: (expanded: boolean) => void; // ★ 追加: メモ表示状態を設定
}

export const useMemoStore = create<MemoStoreState>((set) => ({
  newMemoRequest: null,
  setNewMemoRequest: (request) => set({ newMemoRequest: request }),
  clearNewMemoRequest: () => set({ newMemoRequest: null }), // クリア関数の実装
  memoListLastUpdated: Date.now(), // ★ 初期値を設定
  triggerMemoListRefresh: () => set({ memoListLastUpdated: Date.now() }), // ★ 実装
  isMemoViewExpanded: false, // ★ 初期値を設定
  setMemoViewExpanded: (expanded) => set({ isMemoViewExpanded: expanded }), // ★ 実装
})); 