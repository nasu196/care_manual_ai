'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, PlusCircle, Flag, Trash2, AlertTriangle, XCircle, Save, Loader2 } from 'lucide-react';
import { useMemoStore } from '@/store/memoStore';
import MemoTemplateSuggestions from '@/components/admin/MemoTemplateSuggestions';
import { useAuth } from '@clerk/nextjs';
import RichTextEditor from '@/components/common/RichTextEditor';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
// import { marked } from 'marked'; // 不要になったためコメントアウトまたは削除
import ReactMarkdown from 'react-markdown';
import { AIGeneratedMemoSource } from '@/components/admin/MemoTemplateSuggestions';
import rehypeRaw from 'rehype-raw'; // HTML を安全に解釈するためのプラグイン

// メモの型定義 (仮。実際のEdge Functionの返り値に合わせる)
interface Memo {
  id: string;
  title: string;
  content: string; // HTML文字列として扱う
  created_at: string;
  updated_at: string; // updated_at プロパティを追加
  created_by: string | null;
  is_important: boolean; // is_important プロパティを追加
  is_ai_generated?: boolean; // ★ 追加 (オプショナル)
  ai_generation_sources?: AIGeneratedMemoSource[] | null; // ★ 追加 (オプショナル)
  // 他に必要なフィールドがあれば追加
  isGenerating?: boolean;
  statusText?: string;
}

// Propsの型定義を追加
interface MemoStudioProps {
  selectedSourceNames: string[];
}

const MemoStudio: React.FC<MemoStudioProps> = ({ selectedSourceNames }) => {
  const { getToken, userId, isSignedIn } = useAuth();
  
  const [memos, setMemos] = useState<Memo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const [newMemoTitle, setNewMemoTitle] = useState('');
  const [newMemoContent, setNewMemoContent] = useState(''); // HTML文字列として初期化
  const [isCreatingMemo, setIsCreatingMemo] = useState(false);
  const [createMemoError, setCreateMemoError] = useState<string | null>(null);

  const [isEditingNewMemo, setIsEditingNewMemo] = useState(false); // 新規メモ編集モードの状態

  // 削除機能用のstate
  const [deletingMemoId, setDeletingMemoId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ★閲覧機能用のstate
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);

  // ★編集機能用のstate
  const [isEditingSelectedMemo, setIsEditingSelectedMemo] = useState<boolean>(false);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [editingContent, setEditingContent] = useState<string>(''); // HTML文字列として初期化
  const [isUpdatingMemo, setIsUpdatingMemo] = useState<boolean>(false); // 保存中のローディング
  const [updateMemoError, setUpdateMemoError] = useState<string | null>(null); // 保存エラー

  // 重要度トグル用のstate (トグル中のメモIDを保持してスピナーを表示)
  const [togglingImportantId, setTogglingImportantId] = useState<string | null>(null);
  const [toggleImportantError, setToggleImportantError] = useState<string | null>(null);

  // Zustandストアから状態とアクションを取得
  const newMemoRequest = useMemoStore((state) => state.newMemoRequest);
  const clearNewMemoRequest = useMemoStore((state) => state.clearNewMemoRequest);
  const memoListLastUpdated = useMemoStore((state) => state.memoListLastUpdated);
  const setMemoViewExpanded = useMemoStore((state) => state.setMemoViewExpanded);
  const generatingMemos = useMemoStore((state) => state.generatingMemos);

  // ★ useRef を使って前回の memoListLastUpdated の値を保持
  const prevMemoListLastUpdatedRef = useRef<number | null>(null);

  console.log(`[MemoStudio] Rendering. isSignedIn: ${isSignedIn}, userId: ${userId}`);

  useEffect(() => { // Zustandストアの newMemoRequest を監視するuseEffect
    if (newMemoRequest && !isEditingNewMemo && !selectedMemoId) {
      setNewMemoTitle(newMemoRequest.title);
      // newMemoRequest.content がHTMLであることを前提とする
      setNewMemoContent(newMemoRequest.content); 
      setIsEditingNewMemo(true);
      clearNewMemoRequest(); // ストアのリクエストをクリア
    }
    // isEditingNewMemo と selectedMemoId は依存配列に残し、意図しないタイミングでの実行を防ぐ
  }, [newMemoRequest, clearNewMemoRequest, isEditingNewMemo, selectedMemoId]); // 依存配列にストアの値を追加

  const fetchMemos = useCallback(async () => {
    console.log(`[MemoStudio fetchMemos] Attempting. isSignedIn: ${isSignedIn}, userId: ${userId}`);
    if (!isSignedIn || !userId || !getToken) {
      console.log('[fetchMemos] Not signed in or getToken/userId not available yet.');
      setIsLoading(false); // or true, depending on desired UX before auth ready
      return;
    }
    setIsLoading(true);
    setError(null);
    console.log(`[${new Date().toISOString()}] [fetchMemos] Attempting to fetch memos...`);

    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for list-memos.");
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined.");
      }
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/list-memos`;
      
      const response = await fetch(edgeFunctionUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json', // GETでも念のため付与（なくても良い場合が多い）
        },
      });

      console.log(`[${new Date().toISOString()}] [fetchMemos] Raw response from list-memos:`, response);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`[${new Date().toISOString()}] [fetchMemos] Error from list-memos function (${response.status}):`, errorData);
        throw new Error(errorData.message || `Failed to fetch memos. Status: ${response.status}`);
      }
      
      const data = await response.json();

      if (Array.isArray(data)) {
        console.log(`[${new Date().toISOString()}] [fetchMemos] Successfully fetched ${data.length} memos. Setting memos state.`);
        if (data.length > 0) {
          console.log(`[${new Date().toISOString()}] [fetchMemos] First memo example:`, JSON.stringify(data[0], null, 2));
        }
        setMemos(data.map(m => ({...m, isGenerating: false })) as Memo[]);
      } else {
        console.warn(`[${new Date().toISOString()}] [fetchMemos] Unexpected data structure from list-memos. Expected array, got:`, data);
        setMemos([]); 
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [fetchMemos] Exception during fetch or processing:`, e);
      setError(e as Error);
    } finally {
      setIsLoading(false);
      console.log(`[${new Date().toISOString()}] [fetchMemos] Finished fetching memos. isLoading set to false.`);
    }
  }, [getToken, userId, isSignedIn, setIsLoading, setError, setMemos]);

  // 1. 初回マウント時と、手動での新規メモ編集モード終了時にメモを取得
  useEffect(() => {
    // isEditingNewMemo が false になったとき (新規作成完了 or キャンセル時)
    // または、selectedMemoId が null になったとき (詳細表示からリストに戻った時) にメモを再取得
    if (!isEditingNewMemo && !selectedMemoId) {
      console.log('[Effect 1] Fetching memos: not editing new memo, no selected memo.');
      fetchMemos();
    }
  }, [fetchMemos, isEditingNewMemo, selectedMemoId]); // isLoading を依存配列から削除

  // 2. AIによる自動保存後のメモリスト更新 (memoListLastUpdated が実際に変更された場合のみ)
  useEffect(() => {
    // 前回の値がnull (初回実行時など) でない、かつ現在の値と異なる場合に実行
    if (prevMemoListLastUpdatedRef.current !== null && memoListLastUpdated !== prevMemoListLastUpdatedRef.current /* && !isEditingNewMemo && !selectedMemoId */) {
      console.log('[Effect 2 - Using Ref] Fetching memos due to memoListLastUpdated change.');
      fetchMemos();
    }
    // 現在の値を次回の比較のために保存
    prevMemoListLastUpdatedRef.current = memoListLastUpdated;
  }, [fetchMemos, memoListLastUpdated]); // 依存配列を memoListLastUpdated のみに（fetchMemosも含む）

  const handleCreateMemo = useCallback(async () => {
    if (!isSignedIn || !userId || !getToken) {
      setCreateMemoError('User not authenticated or auth functions not ready.');
      return;
    }
    // contentの空チェックはTiptapのisEmptyを使う方がより正確だが、一旦titleのみで簡易チェック
    if (!newMemoTitle.trim()) { // || editor.isEmpty のようなチェックをTiptapから取得できると良い
      setCreateMemoError('タイトルは必須です。');
      return;
    }
    // Tiptapのコンテンツが空かどうかのチェック (例: <p></p> のような初期状態は空とみなす)
    // 簡単な方法としては、newMemoContentからHTMLタグを除去したテキストが空かどうかで判断
    const plainTextContent = newMemoContent.replace(/<[^>]+>/g, '').trim();
    if (!plainTextContent) {
        setCreateMemoError('内容は必須です。');
        return;
    }

    setIsCreatingMemo(true);
    setCreateMemoError(null);
    const memoData = {
      title: newMemoTitle,
      content: newMemoContent, // HTML文字列をそのまま渡す
    };
    console.log('[handleCreateMemo] memoData to be sent (HTML):', JSON.stringify(memoData));

    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for create-memo.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined.");
      }
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/create-memo`;

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(memoData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`[handleCreateMemo] Error from create-memo function (${response.status}):`, errorData);
        throw new Error(errorData.message || `Failed to create memo. Status: ${response.status}`);
      }

      const newMemo = await response.json();
      console.log('[handleCreateMemo] Memo created successfully by Edge Function:', newMemo);

      setNewMemoTitle('');
      setNewMemoContent('');
      setIsEditingNewMemo(false);
      setMemoViewExpanded(false);
      await fetchMemos(); 
    } catch (e) {
      console.error('[handleCreateMemo] Exception during create memo:', e);
      setCreateMemoError((e as Error).message || 'メモの作成中に不明なエラーが発生しました。');
      // throw e; // エラーを再スローしない場合は、UIでエラーを表示する
    } finally {
      setIsCreatingMemo(false);
    }
  }, [newMemoTitle, newMemoContent, getToken, userId, isSignedIn, fetchMemos, setIsCreatingMemo, setCreateMemoError, setNewMemoTitle, setNewMemoContent, setIsEditingNewMemo, setMemoViewExpanded]);

  const handleDeleteMemo = useCallback(async (memoIdToDelete: string) => {
    if (!isSignedIn || !userId || !getToken) {
        setDeleteError('User not authenticated or auth functions not ready.');
        return;
    }
    if (!window.confirm('このメモを本当に削除しますか？')) return;
    setDeletingMemoId(memoIdToDelete);
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for delete-memo.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined.");
      }
      // DELETEメソッドを使い、memoIdToDeleteをパスパラメータとしてURLに含める
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/delete-memo/${encodeURIComponent(memoIdToDelete)}`; 

      const response = await fetch(edgeFunctionUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`[handleDeleteMemo] Error from delete-memo function (${response.status}):`, errorData);
        throw new Error(errorData.message || `Failed to delete memo. Status: ${response.status}`);
      }

      setMemos((prevMemos) => prevMemos.filter((memo) => memo.id !== memoIdToDelete));
      if (selectedMemoId === memoIdToDelete) {
          setSelectedMemoId(null);
      }
      console.log('Memo deleted successfully:', memoIdToDelete);

    } catch (e) {
      console.error('Failed to delete memo (コンソールエラー):', e);
      let errorMessage = 'メモの削除中に予期せぬエラーが発生しました。';
      if (e instanceof Error) {
        errorMessage = e.message;
        console.log('エラーメッセージ (Error instance): ', errorMessage);
      } else if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
        errorMessage = e.message;
        console.log('エラーメッセージ (Object with message): ', errorMessage);
      } else {
        console.log('エラーメッセージ (Unknown type): ', e);
      }
      setDeleteError(errorMessage);
      console.log('setDeleteError にセットするメッセージ: ', errorMessage);
    } finally {
      setIsDeleting(false);
      setDeletingMemoId(null);
    }
  }, [getToken, userId, isSignedIn, selectedMemoId, setSelectedMemoId, setMemos, setDeleteError]);

  const handleCancelNewMemo = () => {
    setNewMemoTitle('');
    setNewMemoContent('');
    setCreateMemoError(null);
    setIsEditingNewMemo(false);
    setMemoViewExpanded(false); // ★ 新規メモ編集終了時も表示状態を終了
  };

  // AIの回答（マークダウン）をHTMLに変換してエディタにセットする関数の例 (将来的に使用)
  // const setMemoContentFromMarkdown = (markdown: string) => {
  //   // marked.parse() を使用し、結果がstringであることを明示 (v4以降は同期のはず)
  //   const html = marked.parse(markdown);
  //   setNewMemoContent(html as string); // 型アサーションで対応
  // };

  // ★選択されたメモオブジェクトを取得するヘルパー (selectedMemoIdが変更されたら再計算)
  const selectedMemo = React.useMemo(() => {
    if (!selectedMemoId) return null;
    return memos.find(memo => memo.id === selectedMemoId) || null;
  }, [selectedMemoId, memos]);

  const handleViewMemo = (memoId: string) => {
    if (isEditingNewMemo) return;
    setSelectedMemoId(memoId);
    setIsEditingSelectedMemo(false); // 閲覧モードに切り替える際は編集モードを解除
    setUpdateMemoError(null); // エラー表示をクリア
    setMemoViewExpanded(true); // ★ メモ表示状態を開始
  };

  const handleBackToList = () => {
    setSelectedMemoId(null);
    setIsEditingSelectedMemo(false); // 編集モードも解除
    setUpdateMemoError(null); // エラー表示をクリア
    setMemoViewExpanded(false); // ★ メモ表示状態を終了
  };

  const handleStartEdit = () => {
    if (!selectedMemo) return;
    console.log('[MemoStudio] handleStartEdit called. Selected memo content (HTML):', selectedMemo.content); // ログ更新
    setIsEditingSelectedMemo(true);
    setEditingTitle(selectedMemo.title);
    setEditingContent(selectedMemo.content); // HTML文字列をそのままセット
    setUpdateMemoError(null); // エラー表示をクリア
    // メモ編集も表示状態の一種なので、setMemoViewExpanded(true)は既にhandleViewMemoで設定済み
  };

  const handleCancelEdit = () => {
    setIsEditingSelectedMemo(false);
    // editingTitle, editingContent は handleStartEdit で再設定されるのでクリア不要かも
    setUpdateMemoError(null); // エラー表示をクリア
    // 編集キャンセル後も閲覧モードなので、setMemoViewExpanded(true)のまま
  };

  const handleUpdateMemo = useCallback(async () => {
    if (!isSignedIn || !userId || !getToken || !selectedMemoId) {
        setUpdateMemoError('User not authenticated, auth functions not ready, or no memo selected.');
        return;
    }
    // 簡単なバリデーション
    const plainEditingTextContent = editingContent.replace(/<[^>]+>/g, '').trim();
    if (!editingTitle.trim() || !plainEditingTextContent) {
      setUpdateMemoError('タイトルと内容は必須です。');
      return;
    }

    setIsUpdatingMemo(true);
    setUpdateMemoError(null);

    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for update-memo.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined.");
      }
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/update-memo`;

      const memoDataToUpdate = {
        id: selectedMemoId,
        title: editingTitle,
        content: editingContent,
      };

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(memoDataToUpdate),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`[handleUpdateMemo] Error from update-memo function (${response.status}):`, errorData);
        throw new Error(errorData.message || `Failed to update memo. Status: ${response.status}`);
      }

      // 更新成功時は、レスポンスボディに更新後の完全なメモオブジェクトを期待する
      const updatedMemoData = await response.json();

      if (updatedMemoData && typeof updatedMemoData === 'object' && 'id' in updatedMemoData && updatedMemoData.id === selectedMemoId) {
        setMemos(prevMemos => prevMemos.map(m => 
          m.id === selectedMemoId ? { ...(updatedMemoData as Memo), isGenerating: false } : m
        ));
      } else {
        console.warn('update-memo did not return the expected memo object or ID mismatch. Falling back to local update based on editing fields.');
        setMemos(prevMemos => prevMemos.map(m => 
          m.id === selectedMemoId ? { ...m, title: editingTitle, content: editingContent, updated_at: new Date().toISOString(), isGenerating: false } : m // updated_atも更新
        ));
      }
      
      setIsEditingSelectedMemo(false);

    } catch (e) {
      console.error('Failed to update memo:', e);
      if (e instanceof Error) {
        setUpdateMemoError(e.message);
      } else if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') { 
        setUpdateMemoError(e.message);
      } else {
        setUpdateMemoError('メモの更新中に予期せぬエラーが発生しました。');
      }
    } finally {
      setIsUpdatingMemo(false);
    }
  }, [selectedMemoId, editingTitle, editingContent, getToken, userId, isSignedIn, setIsUpdatingMemo, setUpdateMemoError]);

  const handleToggleImportant = useCallback(async (memoIdToToggle: string, newIsImportant: boolean) => {
    // トグル処理中のメモIDを設定（UIでスピナー表示用）
    setTogglingImportantId(memoIdToToggle);

    if (!isSignedIn || !userId || !getToken) {
        setToggleImportantError('User not authenticated or auth functions not ready.');
        setTogglingImportantId(null);
        return;
    }
    // 元のメモの状態を保存 (ロールバック用)
    const originalMemos = [...memos];

    // 1. UIを楽観的に更新
    setMemos(prevMemos => 
      prevMemos.map(m => 
        m.id === memoIdToToggle ? { ...m, is_important: newIsImportant } : m
      )
    );

    try {
      const token = await getToken({ template: 'supabase' });
      if (!token) {
        throw new Error("Failed to get auth token for toggling important status.");
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error("Supabase URL is not defined.");
      }
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/update-memo`; // 同じupdate-memoを使用

      const bodyData = { id: memoIdToToggle, is_important: newIsImportant };

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`[handleToggleImportant] Error from update-memo function (${response.status}):`, errorData);
        throw new Error(errorData.message || `Failed to toggle important status. Status: ${response.status}`);
      }

      // 成功時はレスポンスボディに更新後のメモオブジェクトを期待する（または少なくとも成功ステータス）
      const updatedMemo = await response.json();
      console.log('[handleToggleImportant] Toggle important status response:', updatedMemo);
      
      // UIは楽観的更新済みなので、ここでは特に何もしないか、
      // 返ってきたデータで再度状態を更新しても良い (updated_atなどを反映するため)
      // 今回は、updated_atが返ってくることを期待して、それで更新する
      if (updatedMemo && typeof updatedMemo === 'object' && 'id' in updatedMemo && updatedMemo.id === memoIdToToggle) {
        setMemos(prevMemos => 
          prevMemos.map(m => 
            m.id === memoIdToToggle ? { ...(updatedMemo as Memo), isGenerating: false } : m
          )
        );
      } else {
        // 期待したレスポンスでなかった場合、エラーログを出すなど
        console.warn('[handleToggleImportant] Did not receive expected memo object after toggle.');
      }

    } catch (e) {
      console.error('Failed to toggle important status:', e);
      // 2. エラーが発生したらUIをロールバック
      setMemos(originalMemos);
      let errorMessage = '重要度の更新中にエラーが発生しました。';
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
        errorMessage = e.message;
      }
      setToggleImportantError(errorMessage);
    }
    finally {
      // トグル処理完了
      setTogglingImportantId(null);
    }
  }, [getToken, userId, isSignedIn, setMemos, setToggleImportantError, memos]);

  // ★★★ 表示用メモリストの作成 ★★★
  const displayMemos = React.useMemo(() => {
    const transformedGeneratingMemos: Memo[] = generatingMemos.map(genMemo => {
      let statusText = '';
      switch (genMemo.status) {
        case 'prompt_creating': statusText = 'アイデアを分析中...'; break;
        case 'memo_generating': statusText = 'AIがメモを作成中...'; break;
        case 'saving': statusText = 'メモを保存中...'; break;
        case 'error': statusText = `エラー: ${genMemo.errorMessage || '不明なエラー'}`; break;
        default: statusText = '処理中...';
      }
      return {
        id: genMemo.id, // 一時的なID
        title: genMemo.title,
        content: '', // ★★★ リンターエラー修正: content の後にカンマを追加 ★★★
        created_at: new Date(parseInt(genMemo.id)).toISOString(), // 一時IDから日付生成
        updated_at: new Date(parseInt(genMemo.id)).toISOString(),
        created_by: 'AI Agent',
        is_important: false,
        is_ai_generated: true,
        isGenerating: true,
        statusText: statusText,
      };
    });
    
    // メモをソート: 重要フラグありを一番上に、その後に重要フラグなしを日付順で表示
    const sortedMemos = [...memos].sort((a, b) => {
      // 1. 重要度で最初にソート (重要 = true が上に)
      if (a.is_important !== b.is_important) {
        return a.is_important ? -1 : 1;
      }
      // 2. 重要度が同じ場合は更新日時順 (新しいものが上に)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    
    // generatingMemos (新しいものが上) -> sortedMemos (重要度→日付順)
    return [...transformedGeneratingMemos, ...sortedMemos];
  }, [generatingMemos, memos]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 border-b flex justify-between items-center flex-shrink-0">
        <h2 className="text-lg font-semibold">メモ管理</h2>
        {isSignedIn && !isEditingNewMemo && !selectedMemo && (
          <Button variant="outline" size="sm" onClick={() => {
            setIsEditingNewMemo(true);
            setMemoViewExpanded(true); 
          }}>
            <PlusCircle className="h-4 w-4 mr-2" />
            メモを作成
          </Button>
        )}
      </div>

      <div className="flex-grow min-h-0 overflow-hidden">
        {/* エラー表示エリア (スクロール対象外) */}
        <div className="px-4 pt-2 flex-shrink-0">
          {deleteError && (
            <Alert variant="destructive" className="mb-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>削除エラー</AlertTitle>
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          {updateMemoError && (
            <Alert variant="destructive" className="mb-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>更新エラー</AlertTitle>
              <AlertDescription>{updateMemoError}</AlertDescription>
            </Alert>
          )}
          {toggleImportantError && (
            <Alert variant="destructive" className="mb-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>重要度更新エラー</AlertTitle>
              <AlertDescription>{toggleImportantError}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* メインコンテンツエリア (スクロール対象) */}
        <div className="flex-grow h-full overflow-y-auto px-4 pb-4">
          {selectedMemo ? (
            isEditingSelectedMemo ? (
              <div className="h-full flex flex-col space-y-2 min-h-0">
                <h3 className="text-xl font-semibold mb-2">メモを編集</h3>
                <Input 
                  placeholder="タイトル" 
                  value={editingTitle} 
                  onChange={(e) => setEditingTitle(e.target.value)}
                  disabled={isUpdatingMemo}
                  className="mb-2"
                />
                <div className="flex-grow flex flex-col min-h-0">
                  <RichTextEditor 
                    content={editingContent} 
                    onChange={setEditingContent} 
                    editable={!isUpdatingMemo} 
                  />
                </div>
                <div className="flex justify-end space-x-2 mt-4 flex-shrink-0">
                  <Button variant="outline" onClick={handleCancelEdit} disabled={isUpdatingMemo}>
                    <XCircle className="mr-2 h-4 w-4" />
                    キャンセル
                  </Button>
                  <Button onClick={handleUpdateMemo} disabled={isUpdatingMemo || !editingTitle.trim() || !editingContent.replace(/<[^>]+>/g, '').trim()}>
                    <Save className="mr-2 h-4 w-4" />
                    {isUpdatingMemo ? '保存中...' : '保存する'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col space-y-2 min-h-0">
                <div className="flex justify-between items-center mb-2 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={handleBackToList}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    一覧に戻る
                  </Button>
                  {isSignedIn && (
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (togglingImportantId === selectedMemo.id) return;
                          handleToggleImportant(selectedMemo.id, !selectedMemo.is_important);
                        }}
                        disabled={togglingImportantId === selectedMemo.id}
                        className={`transition-all duration-200 ${
                          selectedMemo.is_important 
                            ? 'text-red-500 hover:text-red-600 hover:bg-red-100' 
                            : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                        }`}
                      >
                        {togglingImportantId === selectedMemo.id ? (
                          <span className="animate-spin h-3 w-3 border border-red-500 border-t-transparent rounded-full mr-2"></span>
                        ) : (
                          <Flag 
                            size={14} 
                            className={`mr-2 transition-all duration-200 ${
                              selectedMemo.is_important 
                                ? "text-red-500 fill-red-500 drop-shadow-sm" 
                                : "hover:scale-110"
                            }`} 
                          />
                        )}
                        {selectedMemo.is_important ? '重要フラグを外す' : '重要フラグを立てる'}
                      </Button>
                      <Button variant="default" size="sm" onClick={handleStartEdit}>
                        編集する
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                  {selectedMemo.is_important && (
                    <Flag size={16} className="text-red-500 fill-red-500 animate-pulse" />
                  )}
                  <h3 className={`text-base sm:text-xl font-semibold whitespace-nowrap truncate max-w-[90vw] ${
                    selectedMemo.is_important ? 'text-red-900' : 'text-gray-900'
                  }`}>
                    {selectedMemo.title}
                  </h3>
                </div>
                <div 
                  className={`flex-grow prose dark:prose-invert max-w-none overflow-y-auto p-2 border rounded-md min-h-0 ${
                    selectedMemo.is_important ? 'border-red-200 bg-red-50/30' : ''
                  }`}
                >
                  {/* HTML タグを含む Markdown を正しくレンダリングするため rehypeRaw を追加 */}
                  <ReactMarkdown rehypePlugins={[rehypeRaw]}>{selectedMemo.content}</ReactMarkdown>
                </div>
              </div>
            )
          ) : isEditingNewMemo ? (
            <div className="h-full flex flex-col space-y-2 min-h-0">
              <h3 className="text-md font-semibold flex-shrink-0">新しいメモを作成</h3>
              <Input 
                placeholder="タイトル" 
                value={newMemoTitle} 
                onChange={(e) => setNewMemoTitle(e.target.value)}
                disabled={isCreatingMemo}
                className="mb-2 flex-shrink-0"
              />
              <div className="flex-grow flex flex-col min-h-0">
                <RichTextEditor 
                  content={newMemoContent} 
                  onChange={setNewMemoContent} 
                  editable={!isCreatingMemo} 
                />
              </div>
              {createMemoError && <p className="text-red-500 text-sm mt-2 flex-shrink-0">{createMemoError}</p>}
              <div className="flex justify-end space-x-2 mt-2 flex-shrink-0">
                <Button variant="outline" onClick={handleCancelNewMemo} disabled={isCreatingMemo}>
                  キャンセル
                </Button>
                <Button 
                  onClick={handleCreateMemo} 
                  disabled={isCreatingMemo || !newMemoTitle.trim() || !newMemoContent.replace(/<[^>]+>/g, '').trim()} 
                >
                  {isCreatingMemo ? '保存中...' : '保存する'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {isSignedIn && (
                <div>
                  <MemoTemplateSuggestions 
                    selectedSourceNames={selectedSourceNames} 
                  />
                </div>
              )}
              
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-4">作成済みメモ</h3>
                {isLoading && <p className="text-center py-8 text-gray-500">メモを読み込み中...</p>}
                {error && (
                  <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-600 text-center">
                    エラー: {error.message || 'メモの読み込みに失敗しました。'}
                  </div>
                )}
                {!isLoading && !error && displayMemos.length === 0 && (
                  <div className="p-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 text-center text-gray-400">
                    <div className="text-4xl mb-2">📝</div>
                    <p>作成済みのメモはありません。</p>
                    <p className="text-xs mt-1">新規メモボタンから最初のメモを作成しましょう。</p>
                  </div>
                )}
                {!isLoading && !error && displayMemos.length > 0 && (
                  <div className="divide-y divide-gray-200">
                    {displayMemos.map((memo) => (
                      <div
                        key={memo.id}
                        className={`group py-3 transition-colors duration-150 ${
                          memo.isGenerating 
                            ? memo.statusText?.includes('エラー') 
                              ? 'opacity-75 bg-red-50 border-l-4 border-l-red-400' 
                              : 'opacity-75 hover:bg-gray-50'
                            : memo.is_important 
                              ? 'bg-red-50/50 hover:bg-red-100/60 border-l-4 border-l-red-400 cursor-pointer' 
                              : 'hover:bg-gray-50 cursor-pointer'
                        }`}
                        onClick={() => memo.isGenerating ? null : handleViewMemo(memo.id)}
                      >
                        <div className={`pl-3 ${memo.is_important && !memo.isGenerating ? '' : ''}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {memo.is_important && !memo.isGenerating && (
                                <Flag size={12} className="text-red-500 fill-red-500 flex-shrink-0 animate-pulse" />
                              )}
                              <h4 className={`font-medium text-sm truncate ${
                                memo.is_important && !memo.isGenerating 
                                  ? 'text-red-900 font-semibold' 
                                  : 'text-gray-900'
                              }`}>
                                {memo.title}
                              </h4>
                            </div>
                            {!memo.isGenerating && (
                              <div className="flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                                {isSignedIn && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (togglingImportantId === memo.id) return;
                                        handleToggleImportant(memo.id, !memo.is_important);
                                      }}
                                      disabled={togglingImportantId === memo.id}
                                      className={`h-6 w-6 p-0 transition-all duration-200 ${
                                        memo.is_important 
                                          ? 'text-red-500 hover:text-red-600 hover:bg-red-100 shadow-sm' 
                                          : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                                      }`}
                                    >
                                      {togglingImportantId === memo.id ? (
                                        <span className="animate-spin h-2 w-2 border border-red-500 border-t-transparent rounded-full"></span>
                                      ) : (
                                        <Flag 
                                          size={10} 
                                          className={`transition-all duration-200 ${
                                            memo.is_important 
                                              ? "text-red-500 fill-red-500 drop-shadow-sm" 
                                              : "hover:scale-110"
                                          }`} 
                                        />
                                      )}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteMemo(memo.id);
                                      }}
                                      disabled={isDeleting && deletingMemoId === memo.id}
                                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                                    >
                                      {isDeleting && deletingMemoId === memo.id ? (
                                        <span className="text-xs leading-none">...</span>
                                      ) : (
                                        <Trash2 size={10} />
                                      )}
                                    </Button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            {memo.isGenerating ? (
                              <div className={`flex items-center ${
                                memo.statusText?.includes('エラー') 
                                  ? 'text-red-600' 
                                  : 'text-blue-600'
                              }`}>
                                {memo.statusText?.includes('エラー') ? (
                                  <XCircle className="mr-1 h-3 w-3" />
                                ) : (
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                )}
                                <span>{memo.statusText}</span>
                              </div>
                            ) : (
                              <div className="flex-1 mr-2 overflow-hidden whitespace-nowrap text-ellipsis">
                                {/* HTMLコンテンツからタグを除去してプレーンテキストとして表示 */}
                                {
                                  memo.content
                                    .replace(/<[^>]+>/g, ' ') // HTMLタグをスペースに置換
                                    .replace(/\s+/g, ' ')    // 連続する空白文字を1つのスペースに
                                    .trim()                   // 前後の空白を除去
                                    .substring(0, 80)       // 80文字に制限
                                }
                                {memo.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 80 && '...'}
                              </div>
                            )}
                            <span className="flex-shrink-0">
                              {new Date(memo.updated_at).toLocaleDateString('ja-JP', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemoStudio; 