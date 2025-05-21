import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button'; // shadcn/uiのButtonをインポート
import { supabase } from '@/lib/supabaseClient'; // Supabase client

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

  useEffect(() => {
    const fetchMemos = async () => {
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
    };

    fetchMemos();
  }, []);

  return (
    <div className="flex h-full flex-col p-4 space-y-4">
      {/* 上部のタイトルやアクションエリア */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">メモ管理</h2> {/* タイトル例 */}
        {/* 将来的にはここに他のアクションボタン等も配置可能 */}
      </div>

      {/* メモを作成ボタン */}
      <Button className="w-full">メモを作成</Button>

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