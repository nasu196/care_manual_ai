import React from 'react';
import type { ReactNode } from 'react';
// import SourcePanel from '@/components/placeholders/SourcePanel'; // Remove if SourceManager is the new default
import SourceManager from '@/components/features/SourceManager'; // パスを修正
import MemoStudio from '@/components/admin/MemoStudio';
import TopHeader from './TopHeader'; // TopHeaderをインポート

interface AppLayoutProps {
  sourceSlot?: ReactNode;
  chatSlot: ReactNode; // 中央のチャットは必須とする
  memoSlot?: ReactNode;
  // headerTitle?: string; // 必要であればタイトルをpropsで渡せるようにする
}

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  // const title = headerTitle || '持続化補助金＜創業型＞公募要領'; // タイトルの設定
  const title = '持続化補助金＜創業型＞公募要領'; // 一旦固定タイトル

  return (
    <div className="flex flex-col h-screen bg-muted/40">
      <TopHeader title={title} />
      
      {/* 3カラムグリッドエリア */}
      {/* flex-grow を追加して残りの高さを占有し、overflow-hiddenで内部の高さが親を超えないようにする */}
      <div className="flex-grow grid grid-cols-12 gap-x-2 p-2 overflow-hidden">
        {/* 左カラム: ソース (3/12幅) */}
        <div className="col-span-3 bg-card rounded-lg shadow h-full overflow-hidden">
          {sourceSlot || <SourceManager />}
        </div>

        {/* 中央カラム: チャット (5/12幅) */}
        <div className="col-span-5 bg-card rounded-lg shadow h-full overflow-hidden">
          {chatSlot}
        </div>

        {/* 右カラム: メモ (4/12幅) */}
        <div className="col-span-4 bg-card rounded-lg shadow h-full overflow-hidden">
          {memoSlot || <MemoStudio />}
        </div>
      </div>
    </div>
  );
};

export default AppLayout; 