import React, { useState } from 'react';
import type { ReactNode } from 'react';
// import SourcePanel from '@/components/placeholders/SourcePanel'; // Remove if SourceManager is the new default
import SourceManager from '@/components/features/SourceManager'; // パスを修正
import MemoStudio from '@/components/admin/MemoStudio';
import TopHeader from './TopHeader'; // TopHeaderをインポート
import { useMemoStore } from '@/store/memoStore'; // ★ memoStoreをインポート

interface AppLayoutProps {
  sourceSlot?: ReactNode;
  chatSlot: ReactNode; // 中央のチャットは必須とする
  memoSlot?: ReactNode;
  // headerTitle?: string; // 必要であればタイトルをpropsで渡せるようにする
}

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  // const title = headerTitle || '持続化補助金＜創業型＞公募要領'; // タイトルの設定
  const [title, setTitle] = useState('持続化補助金＜創業型＞公募要領'); // ★ stateで管理

  // ★ メモ表示状態を取得
  const isMemoViewExpanded = useMemoStore((state) => state.isMemoViewExpanded);

  const handleTitleChange = (newTitle: string) => { // ★ タイトル更新関数
    setTitle(newTitle);
    // TODO: 必要であれば、ここでAPI経由で永続化する処理を追加
  };

  return (
    <div className="flex flex-col h-screen bg-muted/40">
      <TopHeader title={title} onTitleChange={handleTitleChange} />
      
      {/* 3カラムFlexエリア - アニメーションのためGridからFlexに変更 */}
      <div className="flex-grow flex gap-x-2 p-2 overflow-hidden">
        {/* 左カラム: ソース (動的幅: 通常25%、メモ表示時16.7%) */}
        <div 
          className="bg-card rounded-lg shadow h-full overflow-hidden transition-all duration-500 ease-in-out"
          style={{ 
            width: isMemoViewExpanded ? '16.67%' : '25%' // 2/12 vs 3/12
          }}
        >
          {sourceSlot || <SourceManager />}
        </div>

        {/* 中央カラム: チャット (動的幅: 通常41.7%、メモ表示時33.3%) */}
        <div 
          className="bg-card rounded-lg shadow h-full overflow-hidden transition-all duration-500 ease-in-out"
          style={{ 
            width: isMemoViewExpanded ? '33.33%' : '41.67%' // 4/12 vs 5/12
          }}
        >
          {chatSlot}
        </div>

        {/* 右カラム: メモ (動的幅: 通常33.3%、メモ表示時50%) */}
        <div 
          className="bg-card rounded-lg shadow h-full overflow-hidden transition-all duration-500 ease-in-out"
          style={{ 
            width: isMemoViewExpanded ? '50%' : '33.33%' // 6/12 vs 4/12
          }}
        >
          {memoSlot || <MemoStudio />}
        </div>
      </div>
    </div>
  );
};

export default AppLayout; 