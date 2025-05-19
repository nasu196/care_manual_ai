import React from 'react';

interface MemoTemplateSuggestionItemProps {
  // TODO: Define props
  title: string;
  isLastItem?: boolean; // Add isLastItem prop, optional
}

const MemoTemplateSuggestionItem = ({ title, isLastItem }: MemoTemplateSuggestionItemProps) => {
  // TODO: Implement MemoTemplateSuggestionItem
  return (
    <div 
      className={`p-3 cursor-pointer hover:bg-gray-100 ${isLastItem ? '' : 'border-b'}`}
    >
      {title}
    </div>
  );
};

export default MemoTemplateSuggestionItem; 