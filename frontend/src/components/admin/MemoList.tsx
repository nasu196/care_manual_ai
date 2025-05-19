import React from 'react';
import MemoListItem from './MemoListItem';

const dummyMemos = [
  { id: 'memo1', title: '〇〇マニュアルの重要ポイント v1', updatedAt: '2024/07/30 10:00' },
  { id: 'memo2', title: '△△作業の手順メモ', updatedAt: '2024/07/29 15:30' },
  { id: 'memo3', title: '緊急時対応プロトコル抜粋', updatedAt: '2024/07/28 09:00' },
  { id: 'memo4', title: '新人研修用資料案', updatedAt: '2024/07/27 11:00' },
];

const MemoList = () => {
  if (dummyMemos.length === 0) {
    return (
      <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400">
        作成済みのメモはありません。
      </div>
    );
  }

  return (
    <div className="border rounded-md">
      {dummyMemos.map((memo, index) => (
        <MemoListItem 
          key={memo.id} 
          title={memo.title} 
          updatedAt={memo.updatedAt} 
          isLastItem={index === dummyMemos.length - 1}
        />
      ))}
    </div>
  );
};

export default MemoList; 