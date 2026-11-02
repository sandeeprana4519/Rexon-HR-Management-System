import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatMetricCardProps {
  label: string;
  value: string | number;
  subtext: string;
  icon?: LucideIcon;
  tone?: 'default' | 'attention';
}

export const StatMetricCard: React.FC<StatMetricCardProps> = ({
  label,
  value,
  subtext,
  icon: Icon,
  tone = 'default',
}) => {
  return (
    <div className="bg-white border border-[#E5DDD2] rounded-xl p-5 flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-[#574B43] leading-snug">{label}</span>
        {Icon && (
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              tone === 'attention'
                ? 'bg-[#FEF3C7] text-[#B45309]'
                : 'bg-[#F3EDE4] text-[#5C3D2E]'
            }`}
            aria-hidden="true"
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <div>
        <div className="font-mono-tabular text-2xl sm:text-3xl font-semibold text-[#1F1916] tracking-tight">
          {value}
        </div>
        <p className="mt-1 text-xs text-[#7D6F65] leading-normal">{subtext}</p>
      </div>
    </div>
  );
};
