import React from 'react';

interface RexonBrandMarkProps {
  compact?: boolean;
}

export const RexonBrandMark: React.FC<RexonBrandMarkProps> = ({ compact = false }) => {
  return (
    <div className="inline-flex items-center gap-2.5 shrink-0">
      <div
        className="w-9 h-9 rounded-lg bg-[#5C3D2E] flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg className="w-5 h-5 text-[#FAF8F5]" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.75L19.25 5.75V11.5C19.25 16.35 16.12 20.62 12 22C7.88 20.62 4.75 16.35 4.75 11.5V5.75L12 2.75Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M9.75 15.5V8.75H12.75C14.05 8.75 14.95 9.55 14.95 10.75C14.95 11.75 14.32 12.48 13.35 12.7L15.15 15.5H13.55L11.95 12.9H11.15V15.5H9.75Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <span className="font-display font-bold text-[#1F1916] tracking-tight whitespace-nowrap text-base sm:text-lg">
        {compact ? 'REXON HR' : 'REXON HR Management System'}
      </span>
    </div>
  );
};
