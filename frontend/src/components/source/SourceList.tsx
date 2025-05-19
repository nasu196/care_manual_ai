import React from 'react';
import SourceListItem from './SourceListItem';

// Dummy data for sources
const dummySources = [
  { id: 'src1', name: 'r6_koubover2_sogyo1.pdf', isSelected: true },
  { id: 'src2', name: 'manual_xyz_v3.docx', isSelected: false },
  { id: 'src3', name: 'important_notes.txt', isSelected: true },
  { id: 'src4', name: 'another_document_very_long_name_to_test_truncation.pdf', isSelected: false },
];

// TODO: This state should ideally be lifted to SourceManager or a higher context
// For now, managing locally for simplicity in this step.
const SourceList = () => {
  const [sources, setSources] = React.useState(dummySources);

  const handleSelectionChange = (id: string, selected: boolean) => {
    setSources(prevSources => 
      prevSources.map(source => 
        source.id === id ? { ...source, isSelected: selected } : source
      )
    );
    // TODO: Propagate this change upwards if selectAll in SourceManager needs to be updated
  };

  if (sources.length === 0) {
    return (
      <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400 h-full">
        追加されたソースはありません。
      </div>
    );
  }

  return (
    <div className="border rounded-md">
      {sources.map((source, index) => (
        <SourceListItem
          key={source.id}
          id={source.id}
          name={source.name}
          isSelected={source.isSelected}
          onSelectionChange={handleSelectionChange}
          isLastItem={index === sources.length - 1}
        />
      ))}
    </div>
  );
};

export default SourceList; 