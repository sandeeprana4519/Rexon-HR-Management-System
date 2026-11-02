import {
  collection,
  getCountFromServer,
  query,
  where,
} from 'firebase/firestore';
import { LivePortalMetrics, RexonUser } from '../../types';
import { firestoreDb, isFirebaseConfigured } from '../firebase/config';

export const ZERO_METRICS: LivePortalMetrics = {
  branchesCount: 0,
  hrUsersCount: 0,
  clientsCount: 0,
  sitesCount: 0,
  employeesCount: 0,
  fieldOfficersCount: 0,
  pendingApprovalsCount: 0,
  leaveRequestsCount: 0,
  advanceRequestsCount: 0,
};

async function safeCount(q: ReturnType<typeof query>): Promise<number> {
  try {
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch {
    return 0;
  }
}

/**
 * Queries live Firestore document counts strictly scoped to the caller's
 * verified role, branchId, assignedSiteIds, or uid.
 */
export async function fetchLivePortalMetrics(user: RexonUser): Promise<LivePortalMetrics> {
  if (!isFirebaseConfigured || !firestoreDb) {
    return ZERO_METRICS;
  }

  if (user.role === 'admin') {
    const [
      branchesCount,
      hrUsersCount,
      clientsCount,
      sitesCount,
      employeesCount,
      fieldOfficersCount,
      pendingApprovalsCount,
    ] = await Promise.all([
      safeCount(query(collection(firestoreDb, 'branches'))),
      safeCount(query(collection(firestoreDb, 'users'), where('role', '==', 'hr'))),
      safeCount(query(collection(firestoreDb, 'clients'))),
      safeCount(query(collection(firestoreDb, 'sites'))),
      safeCount(
        query(collection(firestoreDb, 'employees'), where('isDeleted', '==', false))
      ),
      safeCount(
        query(
          collection(firestoreDb, 'users'),
          where('role', '==', 'field_officer'),
          where('isActive', '==', true)
        )
      ),
      safeCount(query(collection(firestoreDb, 'approvals'), where('status', '==', 'Pending'))),
    ]);

    return {
      ...ZERO_METRICS,
      branchesCount,
      hrUsersCount,
      clientsCount,
      sitesCount,
      employeesCount,
      fieldOfficersCount,
      pendingApprovalsCount,
    };
  }

  if (user.role === 'hr') {
    const [
      clientsCount,
      sitesCount,
      employeesCount,
      leaveRequestsCount,
      advanceRequestsCount,
      pendingApprovalsCount,
    ] = await Promise.all([
      safeCount(query(collection(firestoreDb, 'clients'), where('branchId', '==', user.branchId))),
      safeCount(query(collection(firestoreDb, 'sites'), where('branchId', '==', user.branchId))),
      safeCount(
        query(
          collection(firestoreDb, 'employees'),
          where('branchId', '==', user.branchId),
          where('isDeleted', '==', false)
        )
      ),
      safeCount(
        query(
          collection(firestoreDb, 'leaveRequests'),
          where('branchId', '==', user.branchId),
          where('status', '==', 'pending')
        )
      ),
      safeCount(
        query(
          collection(firestoreDb, 'advanceRequests'),
          where('branchId', '==', user.branchId),
          where('status', '==', 'pending')
        )
      ),
      safeCount(
        query(
          collection(firestoreDb, 'approvals'),
          where('branchId', '==', user.branchId),
          where('status', '==', 'Pending')
        )
      ),
    ]);

    return {
      ...ZERO_METRICS,
      clientsCount,
      sitesCount,
      employeesCount,
      leaveRequestsCount,
      advanceRequestsCount,
      pendingApprovalsCount,
    };
  }

  if (user.role === 'employee') {
    const [leaveRequestsCount, advanceRequestsCount] = await Promise.all([
      safeCount(
        query(collection(firestoreDb, 'leaveRequests'), where('employeeUid', '==', user.uid))
      ),
      safeCount(
        query(collection(firestoreDb, 'advanceRequests'), where('employeeUid', '==', user.uid))
      ),
    ]);

    return {
      ...ZERO_METRICS,
      sitesCount: user.assignedSiteIds.length,
      leaveRequestsCount,
      advanceRequestsCount,
    };
  }

  return {
    ...ZERO_METRICS,
    sitesCount: user.assignedSiteIds.length,
  };
}
