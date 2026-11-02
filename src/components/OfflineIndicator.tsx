import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      className="fixed bottom-20 lg:bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-[#5C3D2E] px-3.5 py-2 text-xs font-medium text-[#FAF8F5] shadow-md border border-[#3B251A]"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Offline — Cached application shell active; live Firestore sync paused.</span>
    </div>
  );
};
