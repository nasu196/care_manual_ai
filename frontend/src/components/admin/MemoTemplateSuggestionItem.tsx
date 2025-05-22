import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface MemoTemplateSuggestionItemProps {
  // TODO: Define props
  title: string;
  description: string;
  isLastItem?: boolean; // Add isLastItem prop, optional
}

const MemoTemplateSuggestionItem = ({ title, description, isLastItem }: MemoTemplateSuggestionItemProps) => {
  // TODO: Implement MemoTemplateSuggestionItem
  return (
    <Card className={`hover:shadow-md transition-shadow cursor-pointer ${isLastItem ? '' : ''}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600">{description}</p>
      </CardContent>
    </Card>
  );
};

export default MemoTemplateSuggestionItem; 