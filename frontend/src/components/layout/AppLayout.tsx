import React from 'react';
import type { ReactNode } from 'react';
import SourcePanel from '@/components/placeholders/SourcePanel';
import MemoPanel from '@/components/placeholders/MemoPanel';

interface AppLayoutProps {
  sourceSlot?: ReactNode;
  chatSlot: ReactNode; // 中央のチャットは必須とする
  memoSlot?: ReactNode;
}

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  return (
    <div className="grid h-screen grid-cols-12 gap-0">
      {/* 左カラム: ソース (3/12幅) */}
      <div className="col-span-3 border-r border-gray-200">
        {sourceSlot || <SourcePanel />}
      </div>

      {/* 中央カラム: チャット (6/12幅) */}
      <div className="col-span-6">
        {chatSlot} {/* ChatPanelの代わりに実際のチャットUIを渡すことを想定 */}
      </div>

      {/* 右カラム: メモ (3/12幅) */}
      <div className="col-span-3 border-l border-gray-200">
        {memoSlot || <MemoPanel />}
      </div>
    </div>
  );
};

export default AppLayout; 