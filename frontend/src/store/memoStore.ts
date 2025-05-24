import { create } from 'zustand';

interface NewMemoRequest {
  title: string;
  content: string; // Markdown content from chat
}

// ★ 生成中メモの型定義
export interface GeneratingMemo {
  id: string; // 一時的なID (例: Date.now().toString())
  title: string;
  status: 'prompt_creating' | 'memo_generating' | 'saving' | 'error';
  errorMessage?: string;
}

interface MemoStoreState {
  newMemoRequest: NewMemoRequest | null;
  setNewMemoRequest: (request: NewMemoRequest | null) => void;
  clearNewMemoRequest: () => void; // リクエストをクリアする関数を追加
  memoListLastUpdated: number; // ★ 追加: メモリストの最終更新タイムスタンプ
  triggerMemoListRefresh: () => void; // ★ 追加: リスト更新をトリガーする関数
  isMemoViewExpanded: boolean; // ★ 追加: メモ表示・編集中かどうか
  setMemoViewExpanded: (expanded: boolean) => void; // ★ 追加: メモ表示状態を設定

  // ★★★ 編集権限管理用 ★★★
  hasEditPermission: boolean; // ★ 追加: 編集権限があるかどうか
  setEditPermission: (hasPermission: boolean) => void; // ★ 追加: 編集権限を設定

  // ★★★ 生成中メモの進捗管理用 state と actions ★★★
  generatingMemos: GeneratingMemo[];
  addGeneratingMemo: (memo: GeneratingMemo) => void;
  updateGeneratingMemoStatus: (id: string, status: GeneratingMemo['status'], errorMessage?: string) => void;
  removeGeneratingMemo: (id: string) => void;
  isAnyModalOpen: boolean; // ★ 追加: アプリ全体のモーダル表示状態
  setIsAnyModalOpen: (isOpen: boolean) => void; // ★ 追加
}

export const useMemoStore = create<MemoStoreState>((set) => ({
  newMemoRequest: null,
  setNewMemoRequest: (request) => set({ newMemoRequest: request }),
  clearNewMemoRequest: () => set({ newMemoRequest: null }), // クリア関数の実装
  memoListLastUpdated: Date.now(), // ★ 初期値を設定
  triggerMemoListRefresh: () => set({ memoListLastUpdated: Date.now() }), // ★ 実装
  isMemoViewExpanded: false, // ★ 初期値を設定
  setMemoViewExpanded: (expanded) => set({ isMemoViewExpanded: expanded }), // ★ 実装

  // ★★★ 編集権限管理用 ★★★
  hasEditPermission: true, // ★ 初期値を true に変更（デフォルトで編集可能）
  setEditPermission: (hasPermission) => set({ hasEditPermission: hasPermission }), // ★ 実装

  // ★★★ 生成中メモの進捗管理用 state と actions の実装 ★★★
  generatingMemos: [],
  addGeneratingMemo: (memo) => 
    set((state) => ({ generatingMemos: [...state.generatingMemos, memo] })),
  updateGeneratingMemoStatus: (id, status, errorMessage) => 
    set((state) => ({
      generatingMemos: state.generatingMemos.map((m) => 
        m.id === id ? { ...m, status, errorMessage: errorMessage || m.errorMessage } : m
      ),
    })),
  removeGeneratingMemo: (id) => 
    set((state) => ({ 
      generatingMemos: state.generatingMemos.filter((m) => m.id !== id) 
    })),
  isAnyModalOpen: false, // ★ 初期値
  setIsAnyModalOpen: (isOpen) => set({ isAnyModalOpen: isOpen }), // ★ セッター
})); 