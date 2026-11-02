import React from 'react';
import { Loader2 } from 'lucide-react';
import { RexonBrandMark } from './RexonBrandMark';

interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Verifying authentication & Firestore access permissions...',
}) => {
  return (
    <div
      className="min-h-screen w-full bg-[#FAF8F5] flex flex-col items-center justify-center px-6 py-12"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-md bg-white border border-[#E5DDD2] rounded-xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <RexonBrandMark />
        </div>
        <div className="flex items-center justify-center gap-3 text-[#5C3D2E] mb-3">
          <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          <span className="text-sm font-semibold text-[#1F1916]">Checking Session Security</span>
        </div>
        <p className="text-sm text-[#574B43] leading-relaxed">{message}</p>
        <p className="mt-4 text-xs text-[#7D6F65]">
          REXON Security &amp; Manpower Solution
        </p>
      </div>
    </div>
  );
};
