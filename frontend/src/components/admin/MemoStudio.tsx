import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button'; // shadcn/uiのButtonをインポート
import { supabase } from '@/lib/supabaseClient'; // Supabase client
import { Input } from '@/components/ui/input'; // Inputを追加
import { Textarea } from '@/components/ui/textarea'; // Textareaを追加

// 将来的にインポートするコンポーネントの型だけ定義（ダミー）
import MemoTemplateSuggestions from './MemoTemplateSuggestions';
// import MemoList from './MemoList'; // 一旦コメントアウト

// メモの型定義 (仮。実際のEdge Functionの返り値に合わせる)
interface Memo {
  id: string;
  title: string;
  content: string;
  created_at: string;
  created_by: string | null;
  // 他に必要なフィールドがあれば追加
}

const MemoStudio = () => {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const [newMemoTitle, setNewMemoTitle] = useState('');
  const [newMemoContent, setNewMemoContent] = useState('');
  const [isCreatingMemo, setIsCreatingMemo] = useState(false);
  const [createMemoError, setCreateMemoError] = useState<string | null>(null);

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
    fetchMemos();
  }, [fetchMemos]);

  const handleCreateMemo = async () => {
    if (!newMemoTitle.trim() || !newMemoContent.trim()) {
      setCreateMemoError('タイトルと内容は必須です。');
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
          content: newMemoContent,
          created_by: userId, // 取得したユーザーIDを使用
          // tags: [], // 必要であれば追加
          // is_important: false, // 必要であれば追加
        },
      });

      if (createError) {
        throw createError;
      }

      setNewMemoTitle('');
      setNewMemoContent('');
      await fetchMemos(); // メモリストを再取得
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

  return (
    <div className="flex h-full flex-col p-4 space-y-4">
      {/* 上部のタイトルやアクションエリア */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">メモ管理</h2> {/* タイトル例 */}
        {/* 将来的にはここに他のアクションボタン等も配置可能 */}
      </div>

      {/* 新規メモ作成フォーム */}
      <div className="space-y-2 p-4 border rounded-md bg-card">
        <h3 className="text-md font-semibold mb-2">新しいメモを作成</h3>
        <Input 
          placeholder="タイトル" 
          value={newMemoTitle} 
          onChange={(e) => setNewMemoTitle(e.target.value)}
          disabled={isCreatingMemo}
        />
        <Textarea 
          placeholder="内容" 
          value={newMemoContent} 
          onChange={(e) => setNewMemoContent(e.target.value)}
          rows={4}
          disabled={isCreatingMemo}
        />
        <Button onClick={handleCreateMemo} disabled={isCreatingMemo || !newMemoTitle.trim() || !newMemoContent.trim()} className="w-full">
          {isCreatingMemo ? '作成中...' : '作成する'}
        </Button>
        {createMemoError && <p className="text-red-500 text-sm mt-2">{createMemoError}</p>}
      </div>

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
                  <h4 className="text-sm font-semibold mb-1">{memo.title}</h4>
                  <p className="text-xs text-gray-600">
                    {typeof memo.content === 'string' 
                      ? memo.content.substring(0, 80) + (memo.content.length > 80 ? '...' : '') 
                      : '(内容なし)'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* <MemoList /> */} {/* データがmemosステートに入るので、将来的には <MemoList memos={memos} /> のように渡す */}
      </div>
    </div>
  );
};

export default MemoStudio; 