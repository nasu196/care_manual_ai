import React from 'react';
import { Card, /* CardHeader, CardTitle, */ CardContent } from '@/components/ui/card'; // CardHeader, CardTitleをコメントアウトまたは削除
import { Paperclip } from 'lucide-react';
// Tooltipコンポーネントのインポートを削除
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

const MemoTemplateSuggestionItem = ({ suggestion, index, onSuggestionClick }: MemoTemplateSuggestionItemProps) => {
  const { title, source_files } = suggestion;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ 
        duration: 0.3, 
        delay: index * 0.1, 
        ease: [0.215, 0.61, 0.355, 1] 
      }}
      whileHover={{ 
        scale: 1.02, 
        transition: { duration: 0.2 } 
      }}
      whileTap={{ scale: 0.98 }}
      className="flex flex-col"
      onClick={() => onSuggestionClick(suggestion)}
    >
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
    </motion.div>
  );
};

export default MemoTemplateSuggestionItem; 