'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button'; // shadcn/uiのButtonをインポート
import { supabase } from '@/lib/supabaseClient'; // Supabase client
import { Input } from '@/components/ui/input'; // Inputを追加
import RichTextEditor from '@/components/common/RichTextEditor'; // RichTextEditorをインポート
import { PlusCircle, Trash2, AlertTriangle, ArrowLeft, Save, XCircle, Flag } from 'lucide-react'; // Save, XCircle, Flagアイコンを追加
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; // Alertコンポーネントをインポート
import { marked } from 'marked'; // marked をインポート
import { useMemoStore } from '@/store/memoStore'; // Zustandストアをインポート
import { AIGeneratedMemoSource } from './MemoTemplateSuggestions'; // ★ インポートを追加

// 将来的にインポートするコンポーネントの型だけ定義（ダミー）
import MemoTemplateSuggestions from './MemoTemplateSuggestions'; // AISuggestion のエイリアスを削除

// AIが生成するメモのソース情報の型 (MemoTemplateSuggestions.tsxのGeneratedMemoSource)
// interface AIGeneratedMemoSource {
//   id: string;
//   manual_id: string;
//   file_name: string;
//   similarity: number;
//   text_snippet: string;
// }

// AIが生成するメモの型
// interface AIGeneratedMemo {
//   id: string; 
//   title: string; 
//   content: string; 
//   sources: AIGeneratedMemoSource[];
//   createdAt: string; 
// }

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
}

// Propsの型定義を追加
interface MemoStudioProps {
  selectedSourceNames: string[];
}

const MemoStudio: React.FC<MemoStudioProps> = ({ selectedSourceNames }) => {
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
  const initialMemoListLastUpdated = useMemoStore.getState().memoListLastUpdated; // ★ ストアの初期値を取得

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
    try {
      const { data, error: functionError } = await supabase.functions.invoke('list-memos');
      
      if (functionError) {
        throw functionError;
      }

      // dataが直接配列であるか、あるいはdataプロパティ内に配列があるかを確認
      // Edge Functionのlist-memosの実装に依存します。
      // ここではdataが直接メモの配列であると仮定します。
      // もし { data: Memo[] } のような構造なら data.data や response.data.data のようにアクセス
      if (Array.isArray(data)) {
        setMemos(data);
      } else {
        // 想定外のデータ構造の場合
        console.warn('Unexpected data structure from list-memos:', data);
        setMemos([]); // またはエラー処理
      }

    } catch (e) {
      console.error('Failed to fetch memos:', e);
      setError(e instanceof Error ? e : new Error('An unknown error occurred'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 1. 初回マウント時と、手動での新規メモ編集モード終了時にメモを取得
  useEffect(() => {
    if (!isEditingNewMemo) {
      console.log('[Effect 1] Fetching memos because not editing new memo.');
      fetchMemos();
    }
  }, [fetchMemos, isEditingNewMemo]);

  // 2. AIによる自動保存後のメモリスト更新 (memoListLastUpdated が実際に変更された場合のみ)
  useEffect(() => {
    if (memoListLastUpdated !== initialMemoListLastUpdated && !isEditingNewMemo) {
      console.log('[Effect 2] Fetching memos due to memoListLastUpdated change.');
      fetchMemos();
    }
  }, [fetchMemos, memoListLastUpdated, isEditingNewMemo, initialMemoListLastUpdated]);

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
  };

  const handleBackToList = () => {
    setSelectedMemoId(null);
    setIsEditingSelectedMemo(false); // 編集モードも解除
    setUpdateMemoError(null); // エラー表示をクリア
  };

  const handleStartEdit = () => {
    if (!selectedMemo) return;
    setIsEditingSelectedMemo(true);
    setEditingTitle(selectedMemo.title);
    setEditingContent(selectedMemo.content);
    setUpdateMemoError(null); // エラー表示をクリア
  };

  const handleCancelEdit = () => {
    setIsEditingSelectedMemo(false);
    // editingTitle, editingContent は handleStartEdit で再設定されるのでクリア不要かも
    setUpdateMemoError(null); // エラー表示をクリア
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
          m.id === selectedMemoId ? (updatedMemo as Memo) : m
        ));
      } else {
        // Edge Functionが期待した形式のオブジェクトを返さなかったか、idが一致しない場合
        // ローカルの編集内容でフォールバック更新 (またはエラーとして扱うか、fetchMemos() を呼ぶ)
        console.warn('update-memo did not return the expected memo object or ID mismatch. Falling back to local update based on editing fields.');
        setMemos(prevMemos => prevMemos.map(m => 
          m.id === selectedMemoId ? { ...m, title: editingTitle, content: editingContent } : m
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

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2 sticky top-0 z-10 border-b">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">メモ管理</h2>
          {!isEditingNewMemo && !selectedMemo && (
            <Button variant="outline" onClick={() => setIsEditingNewMemo(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              新規メモ
            </Button>
          )}
        </div>
      </div>

      <div className="flex-grow overflow-y-auto p-4 space-y-4">
        {deleteError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>削除エラー</AlertTitle>
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}
        {updateMemoError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>更新エラー</AlertTitle>
            <AlertDescription>{updateMemoError}</AlertDescription>
          </Alert>
        )}
        {toggleImportantError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>重要度更新エラー</AlertTitle>
            <AlertDescription>{toggleImportantError}</AlertDescription>
          </Alert>
        )}

        {selectedMemo ? (
          isEditingSelectedMemo ? (
            <div className="flex-grow flex flex-col space-y-2 overflow-hidden">
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
              <div className="flex justify-end space-x-2 mt-4">
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
            <div className="flex-grow flex flex-col space-y-2 overflow-hidden">
              <div className="flex justify-between items-center mb-2">
                <Button variant="outline" size="sm" onClick={handleBackToList}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  一覧に戻る
                </Button>
                <Button variant="default" size="sm" onClick={handleStartEdit}>
                  編集する
                </Button>
              </div>
              <h3 className="text-xl font-semibold break-all">{selectedMemo.title}</h3>
              <div 
                className="flex-grow prose dark:prose-invert max-w-none overflow-y-auto p-2 border rounded-md" 
                dangerouslySetInnerHTML={{ __html: selectedMemo.content }}
              />
            </div>
          )
        ) : isEditingNewMemo ? (
          <div className="flex-grow flex flex-col space-y-2 overflow-hidden">
            <h3 className="text-md font-semibold">新しいメモを作成</h3>
            <Input 
              placeholder="タイトル" 
              value={newMemoTitle} 
              onChange={(e) => setNewMemoTitle(e.target.value)}
              disabled={isCreatingMemo}
              className="mb-2"
            />
            <div className="flex-grow flex flex-col min-h-0">
              <RichTextEditor 
                content={newMemoContent} 
                onChange={setNewMemoContent} 
                editable={!isCreatingMemo} 
              />
            </div>
            {createMemoError && <p className="text-red-500 text-sm mt-2">{createMemoError}</p>}
            <div className="flex justify-end space-x-2 mt-2">
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
          <>
            <MemoTemplateSuggestions 
              selectedSourceNames={selectedSourceNames} 
              // onMemoGenerated={handleAiMemoGenerated} // ★ このProps渡しを削除
            />
            {/* AIによって生成されたメモの表示エリアを削除 */}
            {/* {aiGeneratedDisplayMemos.length > 0 && ( ... )} */}
            
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">作成済みメモ</h3>
              {isLoading && <p>メモを読み込み中...</p>}
              {error && <p className="text-red-500">エラー: {error.message || 'メモの読み込みに失敗しました。'}</p>}
              {!isLoading && !error && memos.length === 0 && (
                <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400">作成済みのメモはありません。</div>
              )}
              {!isLoading && !error && memos.length > 0 && (
                <div className="space-y-2 pr-1">
                  {memos.map((memo) => (
                    <div
                      key={memo.id}
                      className="p-3 border rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer flex justify-between items-center"
                      onClick={() => handleViewMemo(memo.id)}
                    >
                      <div className="min-w-0 flex-grow mr-2">
                        <div className="flex items-center">
                          {memo.is_important && <Flag size={14} className="mr-1.5 text-red-500 fill-red-500" />}
                          <h3 className="font-semibold text-sm truncate">{memo.title}</h3>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          最終更新: {new Date(memo.updated_at).toLocaleDateString('ja-JP')}
                        </p>
                        <p className="text-xs text-gray-600 overflow-hidden whitespace-nowrap text-ellipsis w-full mt-1">
                          {memo.content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')}
                        </p>
                      </div>
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (togglingImportantId === memo.id) return;
                            handleToggleImportant(memo.id, !memo.is_important);
                          }}
                          disabled={togglingImportantId === memo.id}
                          className="p-1 h-auto text-gray-500 hover:text-red-600"
                        >
                          {togglingImportantId === memo.id ? (
                            <span className="animate-spin h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full"></span>
                          ) : (
                            <Flag size={16} className={memo.is_important ? "text-red-500 fill-red-500" : "text-gray-400"} />
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
                          className="text-red-500 hover:text-red-700"
                        >
                          {isDeleting && deletingMemoId === memo.id ? '削除中...' : <Trash2 size={16} />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MemoStudio; 