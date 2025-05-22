import React from 'react';
import { Card, /* CardHeader, CardTitle, */ CardContent } from '@/components/ui/card'; // CardHeader, CardTitleをコメントアウトまたは削除
import { Paperclip } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from 'framer-motion'; // Framer Motionをインポート

interface MemoTemplateSuggestionItemProps {
  title: string;
  description: string;
  source_files?: string[];
  isLastItem?: boolean;
}

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 120, damping: 12 }
  }
};

const MemoTemplateSuggestionItem = ({ title, description, source_files, isLastItem }: MemoTemplateSuggestionItemProps) => {
  return (
    <motion.div variants={itemVariants}> {/* Card全体をmotion.divでラップし、variantsを適用 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className={`hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full ${isLastItem ? '' : ''} p-2 gap-1`}>
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