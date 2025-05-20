import React from 'react';
import { Button } from '@/components/ui/button';
import { Settings, Share2, BarChart3, MoreHorizontal, UserCircle } from 'lucide-react'; // UserCircleはClerkの代替

interface TopHeaderProps {
  title: string;
}

const TopHeader: React.FC<TopHeaderProps> = ({ title }) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b h-16 bg-background">
      {/* 左側: タイトル */}
      <div className="text-lg font-semibold text-foreground">
        {title}
      </div>

      {/* 右側: 操作ボタンとユーザーアイコン */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
          <BarChart3 className="h-4 w-4" />
          <span className="hidden sm:inline">アナリティクス</span>
        </Button>
        <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
          <Share2 className="h-4 w-4" />
          <span className="hidden sm:inline">共有</span>
        </Button>
        <Button variant="ghost" size="sm" className="flex items-center space-x-1.5">
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">設定</span>
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-5 w-5" />
        </Button>
        {/* TODO: ClerkのUserButtonに置き換える */}
        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          <UserCircle className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
};

export default TopHeader; 