import React from 'react';
import { Search, X } from 'lucide-react';

export interface FilterTabOption {
  value: string;
  label: string;
}

interface DataTableToolbarProps {
  searchQuery: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  filterOptions?: FilterTabOption[];
  activeFilter?: string;
  onFilterChange?: (val: string) => void;
}

export const DataTableToolbar: React.FC<DataTableToolbarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  filterOptions,
  activeFilter,
  onFilterChange,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="w-4 h-4 text-[#7D6F65] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-[#FAF8F5] border border-[#E5DDD2] rounded-lg text-[#1F1916] placeholder:text-[#7D6F65] focus:outline-none focus:bg-white focus:border-[#5C3D2E] transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded text-[#7D6F65] hover:text-[#1F1916]"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filterOptions && filterOptions.length > 0 && onFilterChange && (
        <div
          className="flex items-center gap-1 p-1 bg-[#F3EDE4] rounded-lg overflow-x-auto"
          role="group"
          aria-label="Filter records"
        >
          {filterOptions.map((opt) => {
            const active = activeFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFilterChange(opt.value)}
                className={`min-h-[34px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white text-[#1F1916] shadow-xs'
                    : 'text-[#574B43] hover:text-[#1F1916]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
