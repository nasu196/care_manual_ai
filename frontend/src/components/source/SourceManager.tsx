import React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PlusIcon } from 'lucide-react';

import SourceList from './SourceList'; // Import SourceList

const SourceManager = () => {
  // TODO: Implement state for 'Select All' checkbox and individual source selections
  const [selectAll, setSelectAll] = React.useState(false);

  return (
    <div className="flex h-full flex-col p-4 space-y-4">
      {/* Header: Title and Add button */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">ソース</h2>
        <Button variant="outline" size="sm">
          <PlusIcon className="mr-2 h-4 w-4" />
          追加
        </Button>
      </div>

      {/* Select All Checkbox */}
      <div className="flex items-center space-x-2 p-2 border-b">
        <Checkbox 
          id="select-all-sources"
          checked={selectAll}
          onCheckedChange={() => setSelectAll(!selectAll)} // Basic toggle
        />
        <label
          htmlFor="select-all-sources"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          すべてのソースを選択
        </label>
      </div>

      {/* Source List Placeholder */}
      <div className="flex-grow overflow-y-auto">
        <SourceList />
        {/* 
        <div className="p-4 border rounded-md bg-gray-50 text-center text-gray-400 h-full">
          ソースがここに一覧表示されます
        </div>
        */}
      </div>

    </div>
  );
};

export default SourceManager; 