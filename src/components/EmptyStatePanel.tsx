import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStatePanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const EmptyStatePanel: React.FC<EmptyStatePanelProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => {
  return (
    <div className="py-10 px-6 text-center bg-[#FAF8F5] border border-dashed border-[#D4C7B8] rounded-xl">
      <div className="w-11 h-11 rounded-xl bg-[#F3EDE4] text-[#5C3D2E] flex items-center justify-center mx-auto mb-3.5">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="font-display text-base font-semibold text-[#1F1916]">{title}</h4>
      <p className="mt-1.5 text-sm text-[#574B43] max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="min-h-[42px] px-4 py-2 rounded-lg bg-[#5C3D2E] text-xs font-semibold text-white hover:bg-[#4A3023] transition-colors whitespace-nowrap"
            >
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="min-h-[42px] px-4 py-2 rounded-lg bg-white border border-[#D4C7B8] text-xs font-semibold text-[#4A3023] hover:bg-[#F3EDE4] transition-colors whitespace-nowrap"
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
