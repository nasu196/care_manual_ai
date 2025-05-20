import React from 'react';
import type { ReactNode } from 'react';
// import SourcePanel from '@/components/placeholders/SourcePanel'; // Remove if SourceManager is the new default
import SourceManager from '@/components/source/SourceManager'; // Import the new SourceManager
import MemoStudio from '@/components/admin/MemoStudio';

interface AppLayoutProps {
  sourceSlot?: ReactNode;
  chatSlot: ReactNode; // 中央のチャットは必須とする
  memoSlot?: ReactNode;
}

const AppLayout = ({ sourceSlot, chatSlot, memoSlot }: AppLayoutProps) => {
  return (
    <div className="grid h-screen grid-cols-12 gap-x-2 p-2 bg-muted/40">
      {/* 左カラム: ソース (3/12幅) */}
      <div className="col-span-3 bg-card rounded-lg shadow h-full overflow-hidden">
        {sourceSlot || <SourceManager />}
      </div>

      {/* 中央カラム: チャット (6/12幅) */}
      <div className="col-span-6 bg-card rounded-lg shadow h-full overflow-hidden">
        {chatSlot}
      </div>

      {/* 右カラム: メモ (3/12幅) */}
      <div className="col-span-3 bg-card rounded-lg shadow h-full overflow-hidden">
        {memoSlot || <MemoStudio />}
      </div>
    </div>
  );
};

export default AppLayout; 