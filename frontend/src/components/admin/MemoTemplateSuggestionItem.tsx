import React from 'react';
import { Card, /* CardHeader, CardTitle, */ CardContent } from '@/components/ui/card'; // CardHeader, CardTitleをコメントアウトまたは削除
import { Paperclip } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from 'framer-motion'; // Framer Motionをインポート

// Suggestion 型を MemoTemplateSuggestions.tsx からインポートするか、共通の型定義ファイルからインポートするのが望ましい
// ここでは、MemoTemplateSuggestions.tsx 内で定義されている Suggestion 型と同じものを仮定して使用
interface Suggestion {
  id: string;
  title: string;
  description: string;
  source_files?: string[];
}

interface MemoTemplateSuggestionItemProps {
  suggestion: Suggestion;
  index: number; // アニメーションなどで利用する場合のために残す
  onSuggestionClick: (suggestion: Suggestion) => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (
    i: number // index を受け取るように変更 (カスタムプロパティとして渡す)
  ) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { 
      type: "spring", 
      stiffness: 120, 
      damping: 12, 
      delay: i * 0.05 // 要素ごとにわずかに遅延させる
    }
  })
};

const MemoTemplateSuggestionItem = ({ suggestion, index, onSuggestionClick }: MemoTemplateSuggestionItemProps) => {
  const { title, description, source_files } = suggestion;

  return (
    <motion.div 
      variants={itemVariants}
      custom={index} // custom プロパティで index を渡す
      onClick={() => onSuggestionClick(suggestion)} // カードクリックでコールバックを実行
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className={`hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full p-2 gap-1`}>
            {/* CardHeaderとCardTitleをdivとh3で置き換え */}
            <div className="p-1 pb-0">
              <h3 className="text-sm font-medium">
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
    </motion.div>
  );
};

export default MemoTemplateSuggestionItem; 