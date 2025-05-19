import React from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MemoListItemProps {
  title: string;
  updatedAt?: string;
  isLastItem?: boolean;
}

const MemoListItem = ({ title, updatedAt, isLastItem }: MemoListItemProps) => {
  return (
    <div 
      className={`flex items-center justify-between p-3 hover:bg-gray-50 ${isLastItem ? '' : 'border-b'}`}
    >
      <div className="flex-grow">
        <p className="text-sm font-medium truncate">{title}</p>
        {updatedAt && (
          <p className="text-xs text-gray-500">最終更新: {updatedAt}</p>
        )}
      </div>
      <Button variant="ghost" size="icon" className="ml-2 flex-shrink-0">
        <MoreVertical className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default MemoListItem; 