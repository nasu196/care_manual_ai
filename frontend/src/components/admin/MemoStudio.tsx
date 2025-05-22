import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button'; // shadcn/uiのButtonをインポート
import { supabase } from '@/lib/supabaseClient'; // Supabase client
import { Input } from '@/components/ui/input'; // Inputを追加
import RichTextEditor from '@/components/common/RichTextEditor'; // RichTextEditorをインポート
// import { marked } from 'marked'; // markedをインポート (未使用のためコメントアウト)
import { PlusCircle, Trash2, AlertTriangle } from 'lucide-react'; // 新規メモボタン用アイコン、削除アイコン、アラートアイコン
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"; // Alertコンポーネントをインポート

// 将来的にインポートするコンポーネントの型だけ定義（ダミー）
import MemoTemplateSuggestions from './MemoTemplateSuggestions';
// import MemoList from './MemoList'; // 一旦コメントアウト

// メモの型定義 (仮。実際のEdge Functionの返り値に合わせる)
interface Memo {
  id: string;
  title: string;
  content: string; // HTML文字列として扱う
  created_at: string;
  created_by: string | null;
  // 他に必要なフィールドがあれば追加
}

const MemoStudio = () => {
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

  useEffect(() => {
    if (!isEditingNewMemo) { // 編集モードでないときだけメモをフェッチ
      fetchMemos();
    }
  }, [fetchMemos, isEditingNewMemo]);

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
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        // ユーザーが認証されていない場合、適切なエラーメッセージを設定
        throw new Error('ユーザーが認証されていません。再度ログインしてください。');
      }
      const accessToken = sessionData.session.access_token;

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        throw new Error('Supabase URL is not configured.');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/delete-memo/${memoId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        }
      });

      if (!response.ok) {
        let errorDetail = `Failed to delete memo with status: ${response.status}`;
        try {
            const errorData = await response.json();
            errorDetail = errorData.message || errorData.error || JSON.stringify(errorData);
        } catch (jsonParsingError) {
            console.error('Failed to parse error response JSON:', jsonParsingError);
            errorDetail = response.statusText || errorDetail;
        }
        throw new Error(errorDetail);
      }

      setMemos((prevMemos) => prevMemos.filter((memo) => memo.id !== memoId));

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

  return (
    <div className="flex h-full flex-col p-4 space-y-4">
      {/* ★エラー表示をここに移動 */}
      {deleteError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>エラーが発生しました</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      {/* 上部のタイトルやアクションエリア */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">メモ管理</h2> {/* タイトル例 */}
        {!isEditingNewMemo && (
          <Button variant="outline" onClick={() => setIsEditingNewMemo(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            新規メモ
          </Button>
        )}
      </div>

      {isEditingNewMemo ? (
        <div className="flex-grow flex flex-col space-y-2 overflow-hidden"> {/* overflow-hidden を追加 */}
          <h3 className="text-md font-semibold">新しいメモを作成</h3>
          <Input 
            placeholder="タイトル" 
            value={newMemoTitle} 
            onChange={(e) => setNewMemoTitle(e.target.value)}
            disabled={isCreatingMemo}
            className="mb-2"
          />
          <div className="flex-grow flex flex-col min-h-0"> {/* RichTextEditorが残りの高さを取り、スクロール可能にするための変更 */}
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
          {/* AI提案のメモテンプレート候補 */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">提案</h3>
            <MemoTemplateSuggestions />
            {/*
            <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400">
              AIによるメモテンプレート候補がここに表示されます (7-8個)
            </div>
            */}
          </div>

          {/* 既存メモ一覧 */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">作成済みメモ</h3>
            {isLoading && <p>メモを読み込み中...</p>}
            {error && <p className="text-red-500">エラー: {error.message || 'メモの読み込みに失敗しました。'}</p>}
            {!isLoading && !error && memos.length === 0 && (
              <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400">
                作成済みのメモはありません。
              </div>
            )}
            {!isLoading && !error && memos.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <ul className="space-y-2 pr-2">
                  {memos.map((memo) => (
                    <li key={memo.id} className="p-3 border rounded-md hover:bg-gray-50 cursor-pointer">
                      <div className="flex justify-between items-center">
                        <div className="flex-grow cursor-pointer" onClick={() => console.log('View memo:', memo.id)}>
                          <h4 className="text-sm font-semibold mb-1">{memo.title}</h4>
                          <div 
                            className="text-xs text-gray-600 prose dark:prose-invert max-w-none overflow-hidden line-clamp-3" 
                            dangerouslySetInnerHTML={{ __html: memo.content }} 
                          />
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleDeleteMemo(memo.id)}
                          disabled={isDeleting && deletingMemoId === memo.id}
                          className="ml-2 p-1 h-auto text-red-500 hover:text-red-700"
                        >
                          {isDeleting && deletingMemoId === memo.id ? (
                            <span className="text-xs">削除中...</span>
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MemoStudio; 