import React from 'react';
import MemoTemplateSuggestionItem from './MemoTemplateSuggestionItem';

const dummyTemplates = [
  { id: '1', title: '選択中ソースの要点まとめ' },
  { id: '2', title: '選択中ソースに関するよくある質問と回答' },
  { id: '3', title: '選択中ソースの専門用語解説' },
  { id: '4', title: '選択中ソースの手順ステップバイステップ' },
  { id: '5', title: '選択中ソースのメリット・デメリット' },
  { id: '6', title: '選択中ソースの関連情報リンク集' },
  { id: '7', title: '選択中ソースを元にした教育用クイズ' },
];

const MemoTemplateSuggestions = () => {
  return (
    <div className="border rounded-md">
      {dummyTemplates.map((template, index) => (
        <MemoTemplateSuggestionItem 
          key={template.id} 
          title={template.title} 
          isLastItem={index === dummyTemplates.length - 1}
        />
      ))}
    </div>
  );
};

export default MemoTemplateSuggestions; 