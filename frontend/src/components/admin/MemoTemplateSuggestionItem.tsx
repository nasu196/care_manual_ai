import React from 'react';
import { Card, /* CardHeader, CardTitle, */ CardContent } from '@/components/ui/card'; // CardHeader, CardTitleをコメントアウトまたは削除
import { Paperclip } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MemoTemplateSuggestionItemProps {
  title: string;
  description: string;
  source_files?: string[];
  isLastItem?: boolean;
}

const MemoTemplateSuggestionItem = ({ title, description, source_files, isLastItem }: MemoTemplateSuggestionItemProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card className={`hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full ${isLastItem ? '' : ''} p-2 gap-1`}>
          {/* CardHeaderとCardTitleをdivとh3で置き換え */}
          <div className="p-1 pb-0">
            <h3 className="text-base font-medium">{/* truncate を削除 */} 
              {title}
            </h3>
          </div>
          <CardContent className="p-1 pt-0 flex-grow flex flex-col">
            {/* 説明文の直接表示を削除 */}
            {source_files && source_files.length > 0 && (
              <div className="mt-auto pt-1 border-t border-gray-100">
                <div className="text-xs text-gray-500 flex items-center">
                  <Paperclip size={12} className="mr-1 text-gray-400 flex-shrink-0" />
                  <span className="truncate">
                    {source_files.join(', ')}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};

export default MemoTemplateSuggestionItem; 