import React from 'react';
import { Button } from '@/components/ui/button'; // shadcn/uiのButtonをインポート

// 将来的にインポートするコンポーネントの型だけ定義（ダミー）
import MemoTemplateSuggestions from './MemoTemplateSuggestions';
import MemoList from './MemoList';

const MemoStudio = () => {
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
        <MemoList />
        {/*
        <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400">
          作成済みのメモがここに一覧表示されます
        </div>
        */}
      </div>
    </div>
  );
};

export default MemoStudio; 