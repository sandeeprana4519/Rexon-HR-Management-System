import {
  AssignmentFormInput,
  AssignmentStatus,
  EmployeeAssignmentRecord,
  EmployeeRecord,
  STANDARD_SHIFTS,
  ServiceCategory,
  ShiftDefinition,
  ValidationResult,
} from '../types';

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const parts = isoDate.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return isoDate;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function isValidIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
}

export function isValidTime24h(val: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim());
}

export function parseTimeToMinutes(hhmm: string): number {
  const trimmed = hhmm.trim();
  if (!isValidTime24h(trimmed)) return 480; // fallback 08:00
  const [h, m] = trimmed.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function findStandardShiftByLabel(shiftLabel: string): ShiftDefinition | undefined {
  return STANDARD_SHIFTS.find((s) => s.label === shiftLabel || s.code === shiftLabel);
}

export function computeShiftDurationHours(startTime: string, endTime: string): number {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  let diff = endMin - startMin;
  if (diff <= 0) {
    diff += 24 * 60;
  }
  return Math.round((diff / 60) * 10) / 10;
}

/**
 * Resolves effective lifecycle status from startDate & endDate while preserving
 * terminal states (Completed, Transferred, Cancelled).
 */
export function resolveAssignmentStatusByDates(
  startDate: string,
  endDate: string,
  existingStatus?: AssignmentStatus,
  referenceDate?: string
): AssignmentStatus {
  if (
    existingStatus === 'Completed' ||
    existingStatus === 'Transferred' ||
    existingStatus === 'Cancelled'
  ) {
    return existingStatus;
  }
  const today = referenceDate || getTodayIsoDate();
  const effectiveEnd = endDate?.trim() || '9999-12-31';
  if (effectiveEnd < today) {
    return 'Completed';
  }
  if (startDate > today) {
    return 'Upcoming';
  }
  return 'Active';
}

export function isAssignmentActiveOnDate(
  assignment: EmployeeAssignmentRecord,
  targetDate: string
): boolean {
  if (
    assignment.assignmentStatus === 'Cancelled' ||
    assignment.assignmentStatus === 'Transferred' ||
    assignment.assignmentStatus === 'Completed'
  ) {
    return false;
  }
  const end = assignment.endDate?.trim() || '9999-12-31';
  return assignment.startDate <= targetDate && targetDate <= end;
}

export interface ShiftConflictCandidate {
  startDate: string;
  endDate: string;
  shift: string;
  shiftStartTime: string;
  shiftEndTime: string;
  dutyHours: number;
}

export interface ShiftConflictResult {
  hasConflict: boolean;
  conflictingAssignment?: EmployeeAssignmentRecord;
  reason?: string;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function shiftWindowsOverlapSameDay(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const sA = parseTimeToMinutes(startA);
  let eA = parseTimeToMinutes(endA);
  if (eA <= sA) eA += 1440;

  const sB = parseTimeToMinutes(startB);
  let eB = parseTimeToMinutes(endB);
  if (eB <= sB) eB += 1440;

  // Check day-aligned and +/- 24h wrap for overnight duties
  return (
    intervalsOverlap(sA, eA, sB, eB) ||
    intervalsOverlap(sA, eA, sB + 1440, eB + 1440) ||
    intervalsOverlap(sA + 1440, eA + 1440, sB, eB)
  );
}

/**
 * Detects overlapping duty dates + conflicting shifts or excessive daily hours (> 16h/day)
 * across an employee's existing Active and Upcoming assignments.
 * Supports multiple non-conflicting site assignments (different dates or non-overlapping shifts).
 */
export function detectShiftConflict(
  candidate: ShiftConflictCandidate,
  existingAssignments: EmployeeAssignmentRecord[],
  options?: {
    excludeAssignmentIds?: string[];
  }
): ShiftConflictResult {
  const excluded = new Set(options?.excludeAssignmentIds ?? []);
  const candStart = candidate.startDate.trim();
  const candEnd = candidate.endDate.trim() || '9999-12-31';

  const activeOrUpcoming = existingAssignments.filter(
    (a) =>
      !excluded.has(a.assignmentId) &&
      (a.assignmentStatus === 'Active' || a.assignmentStatus === 'Upcoming')
  );

  let overlappingSameDayHours = candidate.dutyHours || 8;

  for (const existing of activeOrUpcoming) {
    const exStart = existing.startDate.trim();
    const exEnd = existing.endDate.trim() || '9999-12-31';

    const datesOverlap = candStart <= exEnd && exStart <= candEnd;

    if (datesOverlap) {
      if (
        existing.shift === candidate.shift ||
        shiftWindowsOverlapSameDay(
          candidate.shiftStartTime,
          candidate.shiftEndTime,
          existing.shiftStartTime,
          existing.shiftEndTime
        )
      ) {
        return {
          hasConflict: true,
          conflictingAssignment: existing,
          reason: `Shift conflict with existing assignment ${existing.assignmentId} at "${existing.siteName}" (${existing.shift}, ${existing.shiftStartTime}–${existing.shiftEndTime}) during ${existing.startDate} to ${existing.endDate || 'Ongoing'}.`,
        };
      }

      overlappingSameDayHours += existing.dutyHours || 8;
      if (overlappingSameDayHours > 16) {
        return {
          hasConflict: true,
          conflictingAssignment: existing,
          reason: `Combined daily duty hours (${overlappingSameDayHours}h) with assignment ${existing.assignmentId} at "${existing.siteName}" exceed the maximum safe 16-hour daily deployment limit.`,
        };
      }
    } else {
      // Check overnight spillover on adjacent boundary dates:
      // Case 1: existing ends on day D (overnight into D+1 morning) and candidate starts on D+1 before existing ends
      const exStartMin = parseTimeToMinutes(existing.shiftStartTime);
      const exEndMin = parseTimeToMinutes(existing.shiftEndTime);
      const candStartMin = parseTimeToMinutes(candidate.shiftStartTime);
      const candEndMin = parseTimeToMinutes(candidate.shiftEndTime);

      if (exEndMin <= exStartMin && addDaysToIsoDate(exEnd, 1) === candStart) {
        if (candStartMin < exEndMin) {
          return {
            hasConflict: true,
            conflictingAssignment: existing,
            reason: `Overnight shift spillover conflict: assignment ${existing.assignmentId} on ${exEnd} ends at ${existing.shiftEndTime} on ${candStart}, overlapping new shift start ${candidate.shiftStartTime}.`,
          };
        }
      }

      if (candEndMin <= candStartMin && addDaysToIsoDate(candEnd, 1) === exStart) {
        if (exStartMin < candEndMin) {
          return {
            hasConflict: true,
            conflictingAssignment: existing,
            reason: `Overnight shift spillover conflict: new assignment on ${candEnd} ends at ${candidate.shiftEndTime} on ${exStart}, overlapping existing assignment ${existing.assignmentId} starting at ${existing.shiftStartTime}.`,
          };
        }
      }
    }
  }

  return { hasConflict: false };
}

/**
 * Validates that an employee is Active, non-deleted, has no rejected KYC documents,
 * holds the target designation in their approved `assignedDesignations`, and has
 * verified qualification, training, and license checks.
 */
export function validateEmployeeEligibilityForAssignment(
  employee: EmployeeRecord,
  designationId: string,
  serviceCategory?: ServiceCategory,
  serviceId?: string
): ValidationResult {
  if (employee.isDeleted) {
    return {
      valid: false,
      error: `Employee ${employee.employeeId} (${employee.fullName}) is archived/deleted and cannot be assigned.`,
    };
  }

  if (!employee.isActive || employee.employeeStatus !== 'Active') {
    return {
      valid: false,
      error: `Inactive or unavailable employees cannot be assigned to new duties. Current status for ${employee.fullName} (${employee.employeeId}) is "${employee.employeeStatus}".`,
    };
  }

  if (employee.docVerificationSummary === 'Rejected') {
    return {
      valid: false,
      error: `Employee ${employee.fullName} (${employee.employeeId}) has a Rejected document verification status. Resolve rejected KYC/qualification documents before site deployment.`,
    };
  }

  const matchedDesig = employee.assignedDesignations.find(
    (d) => d.designationId === designationId
  );

  if (!matchedDesig) {
    const approvedList =
      employee.assignedDesignations.map((d) => d.designationName).join(', ') || 'None';
    return {
      valid: false,
      error: `${employee.fullName} (${employee.employeeId}) is not approved for the selected designation. Approved designation(s): ${approvedList}.`,
    };
  }

  if (serviceCategory && matchedDesig.serviceCategory !== serviceCategory) {
    return {
      valid: false,
      error: `Selected designation "${matchedDesig.designationName}" belongs to ${matchedDesig.serviceCategory}, not ${serviceCategory}.`,
    };
  }

  if (serviceId && matchedDesig.serviceId !== serviceId) {
    return {
      valid: false,
      error: `Selected designation "${matchedDesig.designationName}" is linked to service "${matchedDesig.serviceName}", not the chosen service.`,
    };
  }

  if (
    !matchedDesig.qualificationVerified ||
    !matchedDesig.trainingVerified ||
    !matchedDesig.licenseVerified
  ) {
    return {
      valid: false,
      error: `Qualification, training, or license verification is incomplete for ${employee.fullName} under "${matchedDesig.designationName}". Complete verification in Employee Management first.`,
    };
  }

  return { valid: true };
}

export function validateAssignmentFormInput(input: AssignmentFormInput): ValidationResult {
  if (!input.employeeId.trim()) {
    return { valid: false, error: 'Select an eligible active employee to assign.' };
  }
  if (!input.branchId.trim()) {
    return { valid: false, error: 'Select a valid Branch.' };
  }
  if (!input.clientId.trim()) {
    return { valid: false, error: 'Select a contracted Client.' };
  }
  if (!input.siteId.trim()) {
    return { valid: false, error: 'Select a deployment Site.' };
  }
  if (!input.serviceCategory) {
    return { valid: false, error: 'Select a Service Category (Security, Housekeeping, or Manpower).' };
  }
  if (!input.serviceId.trim()) {
    return { valid: false, error: 'Select an authorized Service.' };
  }
  if (!input.designationId.trim()) {
    return { valid: false, error: 'Select an authorized Designation.' };
  }
  if (!input.shift.trim()) {
    return { valid: false, error: 'Select a Duty Shift.' };
  }
  if (!isValidTime24h(input.shiftStartTime) || !isValidTime24h(input.shiftEndTime)) {
    return { valid: false, error: 'Enter valid 24-hour shift start and end times (HH:MM).' };
  }
  if (!isValidTime24h(input.reportingTime)) {
    return { valid: false, error: 'Enter a valid 24-hour reporting time (HH:MM).' };
  }
  if (!Number.isFinite(input.dutyHours) || input.dutyHours < 1 || input.dutyHours > 16) {
    return { valid: false, error: 'Duty hours must be between 1 and 16 hours.' };
  }
  if (!input.weeklyOff.trim()) {
    return { valid: false, error: 'Select Weekly Off arrangement.' };
  }
  if (!isValidIsoDate(input.startDate)) {
    return { valid: false, error: 'Select a valid Duty Start Date (YYYY-MM-DD).' };
  }
  if (!isValidIsoDate(input.endDate)) {
    return { valid: false, error: 'Select a valid Duty End Date (YYYY-MM-DD).' };
  }
  if (input.endDate < input.startDate) {
    return { valid: false, error: 'Duty End Date cannot be earlier than Duty Start Date.' };
  }
  return { valid: true };
}

// ============================================================================
// CSV & EXCEL (SpreadsheetML .xls) CLIENT-SIDE EXPORT UTILITIES
// ============================================================================
export function exportTableToCsv(
  fileNameBase: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escapeCell = (val: string | number) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const csvLines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];
  // Include UTF-8 BOM so Excel opens Indian characters & symbols cleanly
  const content = `\uFEFF${csvLines.join('\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileNameBase}-${getTodayIsoDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTableToExcelXml(
  fileNameBase: string,
  sheetTitle: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escapeXml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const safeSheet = escapeXml(sheetTitle.slice(0, 30) || 'REXON Report');

  const headerCells = headers
    .map(
      (h) =>
        `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(String(h))}</Data></Cell>`
    )
    .join('');

  const bodyRows = rows
    .map((row) => {
      const cells = row
        .map((val) => {
          if (typeof val === 'number' && Number.isFinite(val)) {
            return `<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${escapeXml(String(val ?? ''))}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('\n');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1F1916"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FAF8F5"/>
   <Interior ss:Color="#5C3D2E" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${safeSheet}">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([workbookXml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileNameBase}-${getTodayIsoDate()}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
