import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  listOfflineAttendanceQueue,
  subscribeAttendanceData,
  syncOfflineAttendanceQueue,
} from '../services/firestore/attendanceService';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { user, isPreviewSession } = useAuth();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncNote, setSyncNote] = useState<string>('');

  const refreshQueueCount = useCallback(() => {
    if (!user || user.role !== 'employee') {
      setPendingCount(0);
      return;
    }
    setPendingCount(listOfflineAttendanceQueue(user.uid).length);
  }, [user]);

  useEffect(() => {
    refreshQueueCount();
    const unsub = subscribeAttendanceData(() => refreshQueueCount());
    return () => unsub();
  }, [refreshQueueCount]);

  const handleSyncNow = useCallback(async () => {
    if (!user || user.role !== 'employee' || !isOnline || syncing) return;
    setSyncing(true);
    try {
      const res = await syncOfflineAttendanceQueue(user, isPreviewSession);
      refreshQueueCount();
      if (res.syncedCount > 0) {
        setSyncNote(
          `Synced ${res.syncedCount} queued punch(es) for HR verification.`
        );
        setTimeout(() => setSyncNote(''), 4500);
      }
    } finally {
      setSyncing(false);
    }
  }, [user, isPreviewSession, isOnline, syncing, refreshQueueCount]);

  // Auto-attempt idempotent sync when connection returns
  useEffect(() => {
    if (isOnline && pendingCount > 0 && user?.role === 'employee') {
      void handleSyncNow();
    }
  }, [isOnline, pendingCount, user?.role, handleSyncNow]);

  if (isOnline && pendingCount === 0 && !syncNote) return null;

  return (
    <div
      className="fixed bottom-20 lg:bottom-4 right-4 z-50 max-w-md flex items-center gap-3 rounded-xl bg-[#5C3D2E] px-4 py-2.5 text-xs font-medium text-[#FAF8F5] shadow-md border border-[#3B251A]"
      role="status"
      aria-live="polite"
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Offline Mode — Live Firestore sync paused.
            {pendingCount > 0
              ? ` ${pendingCount} attendance punch(es) queued safely (Pending Sync).`
              : ' Attendance punches will queue locally until online.'}
          </span>
        </>
      ) : syncNote ? (
        <span>{syncNote}</span>
      ) : (
        <>
          <span>
            {pendingCount} offline attendance punch(es) awaiting sync (not payroll-eligible until HR-verified).
          </span>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void handleSyncNow()}
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-[#FAF8F5] px-3 py-1.5 text-xs font-semibold text-[#5C3D2E] hover:bg-[#F3EDE4] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </>
      )}
    </div>
  );
};
