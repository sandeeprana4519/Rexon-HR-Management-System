import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationControlsProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;

  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between gap-4 pt-4 border-t border-[#E5DDD2] text-xs text-[#574B43]">
      <div className="font-mono-tabular">
        Showing <span className="font-semibold text-[#1F1916]">{startIdx}</span>–
        <span className="font-semibold text-[#1F1916]">{endIdx}</span> of{' '}
        <span className="font-semibold text-[#1F1916]">{totalItems}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1 rounded-lg border border-[#E5DDD2] bg-[#FAF8F5] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Previous</span>
        </button>
        <span className="font-mono-tabular px-2 text-xs text-[#574B43] whitespace-nowrap">
          Page {currentPage} / {totalPages}
        </span>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="min-h-[38px] px-3 py-1.5 inline-flex items-center gap-1 rounded-lg border border-[#E5DDD2] bg-[#FAF8F5] text-xs font-medium text-[#1F1916] hover:bg-[#F3EDE4] disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
