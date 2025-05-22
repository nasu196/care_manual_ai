import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tag } from 'lucide-react';

interface MemoTemplateSuggestionItemProps {
  title: string;
  description: string;
  source_files?: string[];
  isLastItem?: boolean;
}

const MemoTemplateSuggestionItem = ({ title, description, source_files, isLastItem }: MemoTemplateSuggestionItemProps) => {
  return (
    <Card className={`hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full ${isLastItem ? '' : ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-grow">
        <p className="text-sm text-gray-600 mb-2">{description}</p>
        {source_files && source_files.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <h4 className="text-xs font-semibold text-gray-500 mb-1 flex items-center">
              <Tag size={12} className="mr-1 text-gray-400" />
              参照ソース:
            </h4>
            <div className="flex flex-wrap gap-1">
              {source_files.map((file, index) => (
                <span key={index} className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-sm">
                  {file}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MemoTemplateSuggestionItem; 