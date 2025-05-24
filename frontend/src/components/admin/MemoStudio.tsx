'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, PlusCircle, Flag, Trash2, AlertTriangle, XCircle, Save, Loader2 } from 'lucide-react';
import { useMemoStore } from '@/store/memoStore';
import MemoTemplateSuggestions from '@/components/admin/MemoTemplateSuggestions';
import { supabase } from '@/lib/supabaseClient';
import RichTextEditor from '@/components/common/RichTextEditor';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { marked } from 'marked';
import ReactMarkdown from 'react-markdown';
import { AIGeneratedMemoSource } from '@/components/admin/MemoTemplateSuggestions';

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
  // ★ 編集権限を取得
  const hasEditPermission = useMemoStore((state) => state.hasEditPermission);
  
  const [memos, setMemos] = useState<Memo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const [newMemoTitle, setNewMemoTitle] = useState('');
  const [newMemoContent, setNewMemoContent] = useState(''); // 初期値を空文字列（または <p></p>）に
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
  const [editingContent, setEditingContent] = useState<string>('');
  const [isUpdatingMemo, setIsUpdatingMemo] = useState<boolean>(false); // 保存中のローディング
  const [updateMemoError, setUpdateMemoError] = useState<string | null>(null); // 保存エラー

  // 重要度トグル用のstate
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

  useEffect(() => { // Zustandストアの newMemoRequest を監視するuseEffect
    if (newMemoRequest && !isEditingNewMemo && !selectedMemoId) {
      setNewMemoTitle(newMemoRequest.title);
      try {
        const htmlContent = newMemoRequest.content.includes('<') ? newMemoRequest.content : marked.parse(newMemoRequest.content) as string;
        setNewMemoContent(htmlContent);
      } catch (e) {
        console.error("Markdownの解析に失敗しました:", e);
        setNewMemoContent(newMemoRequest.content); // 解析失敗時はプレーンテキストとしてセット
        setCreateMemoError("メモ内容のMarkdown解析に失敗しました。プレーンテキストとして読み込みます。");
      }
      setIsEditingNewMemo(true);
      clearNewMemoRequest(); // ストアのリクエストをクリア
    }
    // isEditingNewMemo と selectedMemoId は依存配列に残し、意図しないタイミングでの実行を防ぐ
  }, [newMemoRequest, clearNewMemoRequest, isEditingNewMemo, selectedMemoId]); // 依存配列にストアの値を追加

  const fetchMemos = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    console.log(`[${new Date().toISOString()}] [fetchMemos] Attempting to fetch memos...`); // ★ 呼び出し開始ログ
    try {
      const { data, error: functionError } = await supabase.functions.invoke('list-memos');
      
      console.log(`[${new Date().toISOString()}] [fetchMemos] Raw response from list-memos:`, { data, functionError }); // ★ 生レスポンスログ

      if (functionError) {
        console.error(`[${new Date().toISOString()}] [fetchMemos] Error from list-memos function:`, functionError);
        throw functionError;
      }

      if (Array.isArray(data)) {
        console.log(`[${new Date().toISOString()}] [fetchMemos] Successfully fetched ${data.length} memos. Setting memos state.`);
        // ★ 取得したデータの内容を詳細にログ出力 (最初の数件など)
        if (data.length > 0) {
          console.log(`[${new Date().toISOString()}] [fetchMemos] First memo example:`, JSON.stringify(data[0], null, 2));
        }
        setMemos(data.map(m => ({...m, isGenerating: false })) as Memo[]);
      } else {
        console.warn(`[${new Date().toISOString()}] [fetchMemos] Unexpected data structure from list-memos. Expected array, got:`, data);
        setMemos([]); 
      }

    } catch (e) {
      console.error(`[${new Date().toISOString()}] [fetchMemos] Failed to fetch memos:`, e);
      setError(e instanceof Error ? e : new Error('An unknown error occurred'));
    } finally {
      setIsLoading(false);
      console.log(`[${new Date().toISOString()}] [fetchMemos] Finished fetching memos. isLoading set to false.`); // ★ 完了ログ
    }
  }, []);

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

  const handleCreateMemo = async () => {
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let userId = user?.id;

      // 開発用にユーザーIDが取れない場合はダミーIDを使用 (本番では削除または適切な処理)
      if (!userId && process.env.NODE_ENV === 'development') {
        console.warn("User ID not found, using dummy_user_id for development.");
        userId = 'dummy_user_id_dev'; 
      } else if (!userId) {
        throw new Error('ユーザーが認証されていません。ログインしてください。');
      }

      const { error: createError } = await supabase.functions.invoke('create-memo', {
        body: { 
          title: newMemoTitle, 
          content: newMemoContent, // HTMLコンテンツを送信
          created_by: userId, // 取得したユーザーIDを使用
          // tags: [], // 必要であれば追加
          // is_important: false, // 必要であれば追加
        },
      });

      if (createError) {
        throw createError;
      }

      setNewMemoTitle('');
      setNewMemoContent(''); // エディタをクリア (初期状態に戻す)
      setIsEditingNewMemo(false); // 作成後は編集モードを解除
      setMemoViewExpanded(false); // ★ メモ作成完了時も表示状態を終了
      await fetchMemos(); // ★★★ 新規メモ作成成功後にリストを再取得 ★★★
    } catch (e) {
      console.error('Failed to create memo:', e);
      if (e instanceof Error) {
        setCreateMemoError(e.message);
      } else if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
        setCreateMemoError(e.message); // Supabaseからのエラーオブジェクトなどを想定
      } else {
        setCreateMemoError('メモの作成中に予期せぬエラーが発生しました。');
      }
    } finally {
      setIsCreatingMemo(false);
    }
  };

  const handleDeleteMemo = async (memoId: string) => {
    if (!window.confirm('このメモを本当に削除しますか？')) {
      return;
    }

    setDeletingMemoId(memoId);
    setIsDeleting(true);
    setDeleteError(null);

    try {
      // supabase.functions.invoke()を使用して他の関数と同じパターンにする
      const { data, error: functionError } = await supabase.functions.invoke('delete-memo', {
        method: 'DELETE',
        body: { id: memoId } // ボディにIDを含める
      });

      if (functionError) {
        throw functionError;
      }

      // 削除成功時にローカル状態を更新
      setMemos((prevMemos) => prevMemos.filter((memo) => memo.id !== memoId));

      console.log('Memo deleted successfully:', data);

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
  };

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
    setIsEditingSelectedMemo(true);
    setEditingTitle(selectedMemo.title);
    setEditingContent(selectedMemo.content);
    setUpdateMemoError(null); // エラー表示をクリア
    // メモ編集も表示状態の一種なので、setMemoViewExpanded(true)は既にhandleViewMemoで設定済み
  };

  const handleCancelEdit = () => {
    setIsEditingSelectedMemo(false);
    // editingTitle, editingContent は handleStartEdit で再設定されるのでクリア不要かも
    setUpdateMemoError(null); // エラー表示をクリア
    // 編集キャンセル後も閲覧モードなので、setMemoViewExpanded(true)のまま
  };

  const handleUpdateMemo = async () => {
    if (!selectedMemoId || !selectedMemo) return;
    // 簡単なバリデーション
    const plainEditingTextContent = editingContent.replace(/<[^>]+>/g, '').trim();
    if (!editingTitle.trim() || !plainEditingTextContent) {
      setUpdateMemoError('タイトルと内容は必須です。');
      return;
    }

    setIsUpdatingMemo(true);
    setUpdateMemoError(null);

    try {
      const { data: updatedMemo, error: functionError } = await supabase.functions.invoke('update-memo', {
        body: {
          id: selectedMemoId,
          title: editingTitle,
          content: editingContent,
          // updated_by: userId, // もしEdge Function側で更新者を記録する場合
        }
      });

      if (functionError) {
        throw functionError; 
      }

      if (updatedMemo && typeof updatedMemo === 'object' && 'id' in updatedMemo && updatedMemo.id === selectedMemoId) {
        // Edge Functionが更新後の完全なメモオブジェクトを返した場合 (idが一致することも確認)
        setMemos(prevMemos => prevMemos.map(m => 
          m.id === selectedMemoId ? { ...(updatedMemo as Memo), isGenerating: false } : m
        ));
      } else {
        // Edge Functionが期待した形式のオブジェクトを返さなかったか、idが一致しない場合
        // ローカルの編集内容でフォールバック更新 (またはエラーとして扱うか、fetchMemos() を呼ぶ)
        console.warn('update-memo did not return the expected memo object or ID mismatch. Falling back to local update based on editing fields.');
        setMemos(prevMemos => prevMemos.map(m => 
          m.id === selectedMemoId ? { ...m, title: editingTitle, content: editingContent, isGenerating: false } : m
        ));
      }
      
      setIsEditingSelectedMemo(false);
      // ★ メモ更新完了時は閲覧モードに戻るが、メモ表示状態は継続

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
  };

  const handleToggleImportant = async (memoId: string, newIsImportant: boolean) => {
    setTogglingImportantId(memoId);
    setToggleImportantError(null);

    // 元のメモの状態を保存 (ロールバック用)
    const originalMemos = [...memos];

    // 1. UIを楽観的に更新
    setMemos(prevMemos => 
      prevMemos.map(m => 
        m.id === memoId ? { ...m, is_important: newIsImportant } : m
      )
    );

    try {
      const { error: functionError } = await supabase.functions.invoke('update-memo', {
        body: {
          id: memoId,
          is_important: newIsImportant,
          // title や content は変更しないので含めない
        }
      });

      if (functionError) {
        throw functionError;
      }
      // 成功時は特に何もしない (UIは既に更新済み)

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
    } finally {
      setTogglingImportantId(null);
    }
  };

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
        {hasEditPermission && !isEditingNewMemo && !selectedMemo && (
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
                  {hasEditPermission && (
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
                  <ReactMarkdown>{selectedMemo.content}</ReactMarkdown>
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
              {hasEditPermission && (
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
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {hasEditPermission && (
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
                              <p className="truncate flex-1 mr-2">
                                {memo.content
                                  .replace(/#+\s/g, '')          // ヘッダー記号を除去
                                  .replace(/\*\*(.*?)\*\*/g, '$1') // ボールドの**を除去
                                  .replace(/\*(.*?)\*/g, '$1')     // イタリックの*を除去
                                  .replace(/`(.*?)`/g, '$1')       // インラインコードの`を除去
                                  .replace(/\[(.*?)\]\(.*?\)/g, '$1') // リンクからテキスト部分のみ抽出
                                  .replace(/\n/g, ' ')             // 改行をスペースに変換
                                  .replace(/\s+/g, ' ')            // 連続するスペースを1つに
                                  .trim()
                                  .substring(0, 60)}
                                {memo.content.length > 60 && '...'}
                              </p>
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