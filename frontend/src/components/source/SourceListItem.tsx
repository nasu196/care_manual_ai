import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { FileTextIcon } from 'lucide-react'; // Example icon

interface SourceListItemProps {
  id: string;
  name: string;
  isSelected: boolean;
  onSelectionChange: (id: string, selected: boolean) => void;
  isLastItem?: boolean;
}

const SourceListItem = ({ 
  id, 
  name, 
  isSelected, 
  onSelectionChange, 
  isLastItem 
}: SourceListItemProps) => {
  return (
    <div 
      className={`flex items-center space-x-3 p-3 hover:bg-gray-50 ${isLastItem ? '' : 'border-b'}`}
    >
      <Checkbox
        id={`source-${id}`}
        checked={isSelected}
        onCheckedChange={(checked: boolean | 'indeterminate') => onSelectionChange(id, checked === true)}
      />
      <FileTextIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
      <label 
        htmlFor={`source-${id}`}
        className="text-sm font-medium leading-none truncate cursor-pointer flex-grow peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {name}
      </label>
      {/* Potential actions (e.g., delete, info) can be added here */}
    </div>
  );
};

export default SourceListItem; 