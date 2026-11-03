import { sendPasswordResetEmail } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  ApprovalRequestRecord,
  AuditLogRecord,
  AuditModuleName,
  BranchFormInput,
  BranchRecord,
  BranchStatus,
  CategoryManpowerRollup,
  ClientFormInput,
  ClientRecord,
  DesignationFormInput,
  DesignationRecord,
  HR_PERMISSIONS,
  HRAccountStatus,
  HistoryEntry,
  HRProfileFormInput,
  HRProfileRecord,
  MasterActiveStatus,
  OperationType,
  PERMISSION_PROFILE_MAP,
  PermissionProfileName,
  RexonUser,
  SERVICE_CATEGORIES,
  ServiceCategory,
  ServiceFormInput,
  ServiceRecord,
  SiteFormInput,
  SiteGeoQrConfigInput,
  SiteManpowerSummary,
  SiteRecord,
  SiteServiceConfigFormInput,
  SiteServiceConfigRecord,
  SiteStatus,
  SubmitApprovalInput,
} from '../../types';
import {
  computeNonNegativeVacancy,
  normalizeCode,
  validateBranchForm,
  validateClientForm,
  validateDesignationForm,
  validateHRProfileForm,
  validateServiceForm,
  validateSiteForm,
  validateSiteServiceConfigForm,
} from '../../utils/masterValidation';
import {
  getAuthorizedBranchIds,
  hasUserPermission,
  normalizePermissionList,
} from '../../utils/portalConfig';
import { sanitizeInput } from '../../utils/validation';
import {
  firebaseAuth,
  firebaseStorage,
  firestoreDb,
  isFirebaseConfigured,
} from '../firebase/config';
import { handleFirestoreError } from './errorHandler';

const STORAGE_KEY = 'rexon_phase2_master_data_v1';

interface LocalMasterStore {
  branches: BranchRecord[];
  hrProfiles: HRProfileRecord[];
  clients: ClientRecord[];
  sites: SiteRecord[];
  services: ServiceRecord[];
  designations: DesignationRecord[];
  siteServices: SiteServiceConfigRecord[];
  approvals: ApprovalRequestRecord[];
  auditLogs: AuditLogRecord[];
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeMasterData(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

function makeHistoryEntry(
  actor: RexonUser,
  action: string,
  details: string
): HistoryEntry {
  return {
    id: `HST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actorUid: actor.uid,
    actorName: actor.fullName,
    actorRole: actor.role,
    action,
    details,
  };
}

function buildAuditLogObject(
  actor: RexonUser,
  params: {
    logId: string;
    action: string;
    module: AuditModuleName;
    recordId: string;
    branchId: string;
    summary: string;
    timestamp?: string;
  }
): AuditLogRecord {
  return {
    logId: params.logId,
    action: sanitizeInput(params.action, 100),
    module: params.module,
    recordId: sanitizeInput(params.recordId, 64),
    performedBy: `${actor.fullName} (${actor.email})`,
    actorUid: actor.uid,
    role: actor.role,
    branchId: sanitizeInput(params.branchId || actor.branchId || 'ALL', 64),
    timestamp: params.timestamp ?? new Date().toISOString(),
    summary: sanitizeInput(params.summary, 400),
  };
}

function generateNextId(prefix: string, existingIds: string[]): string {
  const year = new Date().getFullYear();
  let maxSeq = 0;
  const pattern = new RegExp(`^${prefix}-\\d{4}-(\\d+)$`);
  for (const id of existingIds) {
    const match = id.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  const candidate = `${prefix}-${year}-${nextSeq}`;
  if (existingIds.includes(candidate)) {
    return `${prefix}-${year}-${nextSeq}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }
  return candidate;
}

function makeRuntimeLogId(): string {
  return `AUD-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

/**
 * Builds the 23 standard REXON Services across Security (7), Housekeeping (7), and Manpower (9)
 * and matching initial Designations so they are persisted in Firestore / data store (never hardcoded in UI).
 */
function buildInitialServicesAndDesignations(): {
  services: ServiceRecord[];
  designations: DesignationRecord[];
} {
  const baseDate = '2026-01-15T09:00:00.000Z';
  const createdBy = 'Rajesh Sharma (Admin)';

  const catalogSpec: {
    category: ServiceCategory;
    name: string;
    code: string;
    desc: string;
    skills: string;
    qualification: string;
    training: string;
    license: string;
  }[] = [
    // SECURITY (7)
    {
      category: 'Security',
      name: 'Security Guard',
      code: 'SEC-GRD',
      desc: 'Unarmed static & perimeter gate access control, visitor logging, and patrol duty.',
      skills: 'Visitor verification, material gate-pass entry, perimeter patrolling, emergency response',
      qualification: 'Minimum 10th Pass (SSC)',
      training: 'PSARA Basic Guard Induction (20 days classroom + 60h field)',
      license: 'Police Verification Certificate (PVC) Mandatory',
    },
    {
      category: 'Security',
      name: 'Security Supervisor',
      code: 'SEC-SUP',
      desc: 'Shift roster supervision, guard briefing, occurrence register audit, and client liaison.',
      skills: 'Shift scheduling, incident escalation, CCTV room coordination, team command',
      qualification: '12th Pass / Graduate or Ex-Serviceman',
      training: 'PSARA Supervisory Leadership & Fire Evacuation Drill',
      license: 'Valid PVC & PSARA Supervisor Endorsement',
    },
    {
      category: 'Security',
      name: 'Gunman',
      code: 'SEC-GUN',
      desc: 'Licensed firearm protection for high-value cash/asset transit and sensitive industrial gates.',
      skills: 'Weapon handling safety, high-alert perimeter defense, threat deterrence',
      qualification: '10th / 12th Pass or Ex-Paramilitary / Ex-Army',
      training: 'Annual Range Firing & Firearm Safety Recertification',
      license: 'Valid All-India / State Arms License + Police Verification',
    },
    {
      category: 'Security',
      name: 'Armed Guard',
      code: 'SEC-ARM',
      desc: 'Armed static post security for vaults, critical infrastructure, and sensitive plants.',
      skills: 'Armed access control, tactical alertness, emergency lockdown execution',
      qualification: '12th Pass / Ex-Serviceman Preferred',
      training: 'Armed Tactical Post Protocol & Crisis Response',
      license: 'Valid Arms License Retainer + PVC Mandatory',
    },
    {
      category: 'Security',
      name: 'Security Incharge',
      code: 'SEC-INC',
      desc: 'Overall multi-shift site security head accountable for SLA compliance and incident zero-tolerance.',
      skills: 'Security SLA management, client audit handling, emergency command, shift deployment',
      qualification: 'Graduate / Ex-JCO Armed Forces',
      training: 'Industrial Security Management & Fire Safety Officer Course',
      license: 'Police Verification & Industrial Security Clearance',
    },
    {
      category: 'Security',
      name: 'Gate Supervisor',
      code: 'SEC-GTS',
      desc: 'Weighbridge, inward/outward vehicle challan verification, and dock traffic control supervisor.',
      skills: 'Challan/invoice reconciliation, weighbridge logging, boom-barrier control',
      qualification: '12th Pass / Graduate with Basic Computer Literacy',
      training: 'Logistics Gate Control & ERP Material Entry Training',
      license: 'Police Verification Certificate (PVC)',
    },
    {
      category: 'Security',
      name: 'Security Officer',
      code: 'SEC-OFC',
      desc: 'Corporate & campus security officer managing electronic surveillance, access cards, and audits.',
      skills: 'Access control systems, CCTV analytics, EHS & fire audit compliance, VIP protocol',
      qualification: 'Graduate + Diploma in Industrial Security / Fire Safety',
      training: 'Corporate Security Operations & Crisis Management Certification',
      license: 'PVC + First-Aid & Fire Safety Certificate',
    },

    // HOUSEKEEPING (7)
    {
      category: 'Housekeeping',
      name: 'Housekeeping Staff',
      code: 'HKP-STF',
      desc: 'Routine floor mopping, restroom sanitization, workstation dusting, and waste segregation.',
      skills: 'Chemical dilution awareness, dry/wet mopping, color-coded sanitization',
      qualification: '8th / 10th Standard or Relevant Facility Experience',
      training: 'REXON Hygiene, Chemical Safety & PPE Induction',
      license: 'Identity & Police Background Check',
    },
    {
      category: 'Housekeeping',
      name: 'Housekeeping Supervisor',
      code: 'HKP-SUP',
      desc: 'Checklist inspection, chemical stock control, and zone-wise housekeeping deployment.',
      skills: 'Washroom/floor scorecards, consumable inventory, shift task allocation',
      qualification: '12th Pass / Diploma in Hospitality or Facility Management',
      training: 'Facility Hygiene Audit & Bio-Medical / Industrial Waste Handling',
      license: 'PVC & EHS Hygiene Compliance',
    },
    {
      category: 'Housekeeping',
      name: 'Cleaning Staff',
      code: 'HKP-CLN',
      desc: 'Shopfloor, warehouse aisle, common utility, and yard sweeping/cleaning operations.',
      skills: 'Industrial sweeping, scrap/waste bin clearance, spill cleanup',
      qualification: 'Basic Literacy & Physical Fitness',
      training: 'Shopfloor Safety & Waste Segregation Orientation',
      license: 'Standard KYC & Police Verification',
    },
    {
      category: 'Housekeeping',
      name: 'Deep Cleaning Staff',
      code: 'HKP-DCL',
      desc: 'Periodic high-pressure jet washing, facade/glass cleaning, upholstery shampooing, and sanitization.',
      skills: 'Steam sanitization, floor buffing, stain treatment, PPE harness awareness',
      qualification: '10th Pass or 1+ Year Deep Cleaning Experience',
      training: 'Specialized Chemical MSDS & High-Reach Safety Training',
      license: 'Medical Fitness & PVC',
    },
    {
      category: 'Housekeeping',
      name: 'Office Boy',
      code: 'HKP-OFB',
      desc: 'Internal document dispatch, meeting room readiness, stationery support, and visitor hospitality.',
      skills: 'File movement, boardroom setup, photocopying/scanning, polite etiquette',
      qualification: '10th / 12th Pass',
      training: 'Corporate Etiquette & Workplace Grooming Module',
      license: 'Standard KYC & PVC',
    },
    {
      category: 'Housekeeping',
      name: 'Pantry Staff',
      code: 'HKP-PNT',
      desc: 'Corporate pantry beverage service, cafeteria counter hygiene, and executive refreshment management.',
      skills: 'Beverage preparation, food-grade hygiene, vending machine upkeep',
      qualification: '10th Pass with Hospitality Experience',
      training: 'FSSAI Food Handler Hygiene & Grooming Certification',
      license: 'Medical Fitness Certificate (Food Handler) + PVC',
    },
    {
      category: 'Housekeeping',
      name: 'Cleaning Machine Operator',
      code: 'HKP-CMO',
      desc: 'Operation of ride-on/walk-behind auto-scrubbers, single-disc buffers, and industrial vacuums.',
      skills: 'Ride-on scrubber operation, battery/brush maintenance, epoxy floor care',
      qualification: '10th Pass + Mechanized Housekeeping Experience',
      training: 'OEM Mechanized Scrubber & Electrical Safety Training',
      license: 'Equipment Operator Authorization + PVC',
    },

    // MANPOWER (9)
    {
      category: 'Manpower',
      name: 'Factory Worker',
      code: 'MNP-FCW',
      desc: 'Production line support, sub-assembly handling, material feeding, and shopfloor 5S.',
      skills: 'Assembly line discipline, PPE adherence, basic quality visual check',
      qualification: '10th / 12th Pass',
      training: 'Industrial Shopfloor Safety & 5S Orientation',
      license: 'ESIC/EPF Eligibility & Factory Gate Medical Fitness',
    },
    {
      category: 'Manpower',
      name: 'Helper',
      code: 'MNP-HLP',
      desc: 'General utility assistance across manufacturing bays, stores, maintenance, and dispatch.',
      skills: 'Material movement, tool assistance, workstation support',
      qualification: '8th / 10th Standard',
      training: 'Workplace Safety & Manual Handling Induction',
      license: 'Standard KYC & Medical Fitness',
    },
    {
      category: 'Manpower',
      name: 'Loader',
      code: 'MNP-LDR',
      desc: 'Outbound truck/container loading, pallet stacking, and dispatch bay material handling.',
      skills: 'Safe lifting posture, pallet stacking, hand-pallet trolley handling',
      qualification: 'Physical Fitness & Basic Literacy',
      training: 'Ergonomic Lifting & Dock Bay Safety Training',
      license: 'Physical Fitness Clearance & KYC',
    },
    {
      category: 'Manpower',
      name: 'Unloader',
      code: 'MNP-ULD',
      desc: 'Inbound raw material and carton unloading, de-stuffing, and staging at receiving docks.',
      skills: 'Container de-stuffing, damage-free carton handling, bay staging',
      qualification: 'Physical Fitness & Basic Literacy',
      training: 'Dock Safety & Material Stacking Orientation',
      license: 'Physical Fitness Clearance & KYC',
    },
    {
      category: 'Manpower',
      name: 'Packing Staff',
      code: 'MNP-PCK',
      desc: 'Secondary carton packing, barcode labeling, shrink-wrapping, and dispatch kitting.',
      skills: 'Carton sealing, SKU label accuracy, strapping & shrink-wrap machine use',
      qualification: '10th Pass (Able to read SKU codes & batch labels)',
      training: 'Packaging SOP & Barcode Quality Check Training',
      license: 'Standard KYC & Police Verification',
    },
    {
      category: 'Manpower',
      name: 'Machine Operator',
      code: 'MNP-MOP',
      desc: 'Operation of CNC/press/molding/packaging machines per shopfloor work instructions.',
      skills: 'Machine setting, gauge measurement, cycle monitoring, LOTO safety',
      qualification: 'ITI (Fitter / Machinist / Turner / Electrical) or Diploma',
      training: 'LOTO (Lockout-Tagout) & Machine Shop Safety Certification',
      license: 'ITI Trade Certificate + PVC',
    },
    {
      category: 'Manpower',
      name: 'Data Entry Operator',
      code: 'MNP-DEO',
      desc: 'ERP/WMS inward-outward data entry, attendance sheet digitization, and MIS reporting.',
      skills: '35+ WPM typing, MS Excel / ERP entry, challan & invoice verification',
      qualification: 'Graduate + Basic Computer / Tally / Excel Proficiency',
      training: 'ERP Data Accuracy & Confidentiality Orientation',
      license: 'Standard KYC & PVC',
    },
    {
      category: 'Manpower',
      name: 'Skilled Worker',
      code: 'MNP-SKW',
      desc: 'Certified technical tradesperson (electrician, welder, fitter, plumber, HVAC technician).',
      skills: 'Technical troubleshooting, blueprint reading, preventive maintenance',
      qualification: 'ITI / NCVT Trade Certificate or 3+ Years Certified Experience',
      training: 'Work-Permit System, Electrical/Hot-Work EHS Training',
      license: 'Valid Wireman / Trade License (where applicable) + PVC',
    },
    {
      category: 'Manpower',
      name: 'Unskilled Worker',
      code: 'MNP-USW',
      desc: 'Entry-level manual labor for sorting, shifting, yard upkeep, and non-technical tasks.',
      skills: 'Manual task execution, shift punctuality, PPE compliance',
      qualification: 'Basic Literacy & Physical Stamina',
      training: 'Site Safety & PPE Mandatory Induction',
      license: 'Standard KYC Verification',
    },
  ];

  const services: ServiceRecord[] = [];
  const designations: DesignationRecord[] = [];

  catalogSpec.forEach((item, index) => {
    const seq = String(index + 1).padStart(4, '0');
    const serviceId = `SRV-2026-${seq}`;
    const designationId = `DSG-2026-${seq}`;

    services.push({
      serviceId,
      serviceName: item.name,
      serviceCategory: item.category,
      serviceCode: item.code,
      description: item.desc,
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    });

    designations.push({
      designationId,
      designationName: item.name,
      serviceCategory: item.category,
      relatedServiceId: serviceId,
      relatedServiceName: item.name,
      description: item.desc,
      requiredSkills: item.skills,
      qualification: item.qualification,
      trainingRequirements: item.training,
      licenseRequirements: item.license,
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    });
  });

  return { services, designations };
}

function buildInitialSiteServicesSeed(): SiteServiceConfigRecord[] {
  const createdBy = 'Priya Verma (Senior HR)';
  const baseDate = '2026-02-05T10:00:00.000Z';

  return [
    // Site STE-2026-0001 (Apex Chakan Assembly Plant — Unit 1) configured with ALL THREE categories: Security, Housekeeping & Manpower
    {
      siteServiceId: 'SSC-2026-0001',
      siteId: 'STE-2026-0001',
      siteName: 'Apex Chakan Assembly Plant — Unit 1',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Security',
      serviceId: 'SRV-2026-0001',
      serviceName: 'Security Guard',
      designationId: 'DSG-2026-0001',
      designationName: 'Security Guard',
      requiredCount: 12,
      deployedCount: 10,
      vacantCount: 2,
      shiftType: 'Rotational 3-Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Reliever Covered (No Post Gap)',
      serviceStartDate: '2026-02-01',
      serviceEndDate: '2027-01-31',
      notes: 'Main Gate, Weighbridge, and Perimeter Posts 1–4.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    {
      siteServiceId: 'SSC-2026-0002',
      siteId: 'STE-2026-0001',
      siteName: 'Apex Chakan Assembly Plant — Unit 1',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Security',
      serviceId: 'SRV-2026-0002',
      serviceName: 'Security Supervisor',
      designationId: 'DSG-2026-0002',
      designationName: 'Security Supervisor',
      requiredCount: 3,
      deployedCount: 3,
      vacantCount: 0,
      shiftType: 'Rotational 3-Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Reliever Covered (No Post Gap)',
      serviceStartDate: '2026-02-01',
      serviceEndDate: '2027-01-31',
      notes: '1 Shift Supervisor per 8-hour shift.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    {
      siteServiceId: 'SSC-2026-0003',
      siteId: 'STE-2026-0001',
      siteName: 'Apex Chakan Assembly Plant — Unit 1',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Housekeeping',
      serviceId: 'SRV-2026-0008',
      serviceName: 'Housekeeping Staff',
      designationId: 'DSG-2026-0008',
      designationName: 'Housekeeping Staff',
      requiredCount: 8,
      deployedCount: 7,
      vacantCount: 1,
      shiftType: 'Day Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Sunday Fixed',
      serviceStartDate: '2026-02-01',
      serviceEndDate: '2027-01-31',
      notes: 'Admin block, washrooms, and canteen hygiene.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    {
      siteServiceId: 'SSC-2026-0004',
      siteId: 'STE-2026-0001',
      siteName: 'Apex Chakan Assembly Plant — Unit 1',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Manpower',
      serviceId: 'SRV-2026-0015',
      serviceName: 'Factory Worker',
      designationId: 'DSG-2026-0015',
      designationName: 'Factory Worker',
      requiredCount: 20,
      deployedCount: 18,
      vacantCount: 2,
      shiftType: 'Rotational 3-Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Rotational (1 Day/Week)',
      serviceStartDate: '2026-02-01',
      serviceEndDate: '2027-01-31',
      notes: 'Assembly Bay A & B material feeding and sub-assembly.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    // Site STE-2026-0002 (Apex Central Logistics Warehouse — Unit 2)
    {
      siteServiceId: 'SSC-2026-0005',
      siteId: 'STE-2026-0002',
      siteName: 'Apex Central Logistics Warehouse — Unit 2',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Security',
      serviceId: 'SRV-2026-0006',
      serviceName: 'Gate Supervisor',
      designationId: 'DSG-2026-0006',
      designationName: 'Gate Supervisor',
      requiredCount: 2,
      deployedCount: 2,
      vacantCount: 0,
      shiftType: 'Day Shift (12h)',
      workingHours: '12 Hours',
      weeklyOff: 'Reliever Covered (No Post Gap)',
      serviceStartDate: '2026-02-15',
      serviceEndDate: '2027-01-31',
      notes: 'Inbound/outbound container seal & challan verification.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    {
      siteServiceId: 'SSC-2026-0006',
      siteId: 'STE-2026-0002',
      siteName: 'Apex Central Logistics Warehouse — Unit 2',
      clientId: 'CLT-2026-0001',
      branchId: 'BRN-2026-0002',
      serviceCategory: 'Manpower',
      serviceId: 'SRV-2026-0017',
      serviceName: 'Loader',
      designationId: 'DSG-2026-0017',
      designationName: 'Loader',
      requiredCount: 10,
      deployedCount: 9,
      vacantCount: 1,
      shiftType: 'General Shift (9h)',
      workingHours: '9 Hours',
      weeklyOff: 'Sunday Fixed',
      serviceStartDate: '2026-02-15',
      serviceEndDate: '2027-01-31',
      notes: 'Dispatch dock loading crew.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    // Site STE-2026-0003 (LifeCare Main Hospital Wing)
    {
      siteServiceId: 'SSC-2026-0007',
      siteId: 'STE-2026-0003',
      siteName: 'LifeCare Main Hospital Wing & Emergency Trauma Center',
      clientId: 'CLT-2026-0002',
      branchId: 'BRN-2026-0001',
      serviceCategory: 'Security',
      serviceId: 'SRV-2026-0001',
      serviceName: 'Security Guard',
      designationId: 'DSG-2026-0001',
      designationName: 'Security Guard',
      requiredCount: 14,
      deployedCount: 14,
      vacantCount: 0,
      shiftType: 'Rotational 3-Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Reliever Covered (No Post Gap)',
      serviceStartDate: '2026-01-15',
      serviceEndDate: '2026-12-31',
      notes: 'ICU lobby, trauma bay, and ambulance lane marshals.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
    {
      siteServiceId: 'SSC-2026-0008',
      siteId: 'STE-2026-0003',
      siteName: 'LifeCare Main Hospital Wing & Emergency Trauma Center',
      clientId: 'CLT-2026-0002',
      branchId: 'BRN-2026-0001',
      serviceCategory: 'Housekeeping',
      serviceId: 'SRV-2026-0011',
      serviceName: 'Deep Cleaning Staff',
      designationId: 'DSG-2026-0011',
      designationName: 'Deep Cleaning Staff',
      requiredCount: 6,
      deployedCount: 5,
      vacantCount: 1,
      shiftType: 'Rotational 3-Shift (8h)',
      workingHours: '8 Hours',
      weeklyOff: 'Rotational (1 Day/Week)',
      serviceStartDate: '2026-01-15',
      serviceEndDate: '2026-12-31',
      notes: 'OT corridor and ward sanitization team.',
      status: 'Active',
      createdBy,
      createdAt: baseDate,
      updatedAt: baseDate,
    },
  ];
}

function buildInitialApprovalsSeed(): ApprovalRequestRecord[] {
  return [
    {
      approvalId: 'APR-2026-0001',
      requestType: 'Site Sanctioned Strength Override',
      module: 'Site',
      targetRecordId: 'STE-2026-0001',
      targetRecordName: 'Apex Chakan Assembly Plant — Unit 1',
      branchId: 'BRN-2026-0002',
      requestedByUid: 'demo-hr-001',
      requestedByName: 'Priya Verma (Senior HR)',
      requestedByRole: 'hr',
      summary: 'Add 2 Armed Guard posts for new Finished Goods Vault at Unit 1',
      reason:
        'Client Plant Head requested armed coverage for high-value export dispatch bay effective next billing cycle.',
      status: 'Pending',
      reviewedByUid: null,
      reviewedByName: null,
      reviewRemarks: '',
      createdAt: '2026-04-16T10:15:00.000Z',
      updatedAt: '2026-04-16T10:15:00.000Z',
      decidedAt: null,
    },
    {
      approvalId: 'APR-2026-0002',
      requestType: 'Client Sensitive Change',
      module: 'Client',
      targetRecordId: 'CLT-2026-0002',
      targetRecordName: 'LifeCare Multispeciality Hospital Trust',
      branchId: 'BRN-2026-0001',
      requestedByUid: 'demo-hr-001',
      requestedByName: 'Priya Verma (Senior HR)',
      requestedByRole: 'hr',
      summary: 'Revise billing cycle terms to 7th of Every Month for LifeCare Hospital',
      reason: 'Aligned monthly attendance cut-off with Hospital Finance Wing SLA addendum.',
      status: 'Approved',
      reviewedByUid: 'demo-admin-001',
      reviewedByName: 'Rajesh Sharma (Demo Admin)',
      reviewRemarks: 'Verified signed client SLA addendum; billing terms approved.',
      createdAt: '2026-04-08T09:20:00.000Z',
      updatedAt: '2026-04-08T11:45:00.000Z',
      decidedAt: '2026-04-08T11:45:00.000Z',
    },
  ];
}

function buildInitialAuditLogsSeed(): AuditLogRecord[] {
  return [
    {
      logId: 'AUD-2026-0006',
      action: 'Approval Submitted',
      module: 'Approvals',
      recordId: 'APR-2026-0001',
      performedBy: 'Priya Verma (hr@rexon.com)',
      actorUid: 'demo-hr-001',
      role: 'hr',
      branchId: 'BRN-2026-0002',
      timestamp: '2026-04-16T10:15:00.000Z',
      summary: 'Submitted approval APR-2026-0001 for Armed Guard post addition on STE-2026-0001.',
    },
    {
      logId: 'AUD-2026-0005',
      action: 'Permission Changed',
      module: 'Permissions',
      recordId: 'HR-2026-0001',
      performedBy: 'Rajesh Sharma (admin@rexon.com)',
      actorUid: 'demo-admin-001',
      role: 'admin',
      branchId: 'BRN-2026-0001',
      timestamp: '2026-04-14T15:30:00.000Z',
      summary: 'Assigned Full Branch Operations permissions (15 capabilities) across MUM-HQ and PUN-IND.',
    },
    {
      logId: 'AUD-2026-0004',
      action: 'Site Updated',
      module: 'SiteService',
      recordId: 'STE-2026-0001',
      performedBy: 'Priya Verma (hr@rexon.com)',
      actorUid: 'demo-hr-001',
      role: 'hr',
      branchId: 'BRN-2026-0002',
      timestamp: '2026-04-12T11:20:00.000Z',
      summary: 'Configured Security, Housekeeping, and Manpower post requirements (43 required / 38 deployed / 5 vacant).',
    },
    {
      logId: 'AUD-2026-0003',
      action: 'Approval Approved',
      module: 'Approvals',
      recordId: 'APR-2026-0002',
      performedBy: 'Rajesh Sharma (admin@rexon.com)',
      actorUid: 'demo-admin-001',
      role: 'admin',
      branchId: 'BRN-2026-0001',
      timestamp: '2026-04-08T11:45:00.000Z',
      summary: 'Approved APR-2026-0002 for LifeCare Hospital billing cycle alignment.',
    },
    {
      logId: 'AUD-2026-0002',
      action: 'Service Created',
      module: 'Service',
      recordId: 'SRV-2026-0001',
      performedBy: 'Rajesh Sharma (admin@rexon.com)',
      actorUid: 'demo-admin-001',
      role: 'admin',
      branchId: 'BRN-2026-0001',
      timestamp: '2026-01-15T09:05:00.000Z',
      summary: 'Initialized 23 standard REXON Services & Designations across Security, Housekeeping, and Manpower.',
    },
    {
      logId: 'AUD-2026-0001',
      action: 'Branch Created',
      module: 'Branch',
      recordId: 'BRN-2026-0001',
      performedBy: 'Rajesh Sharma (admin@rexon.com)',
      actorUid: 'demo-admin-001',
      role: 'admin',
      branchId: 'BRN-2026-0001',
      timestamp: '2026-01-15T09:00:00.000Z',
      summary: 'Created Mumbai Corporate & Western Command (MUM-HQ) master branch.',
    },
  ];
}

function buildInitialSeedStore(): LocalMasterStore {
  const baseDate = '2026-04-10T09:00:00.000Z';
  const seedActor: RexonUser = {
    uid: 'system-seed',
    fullName: 'REXON System Setup',
    email: 'admin@rexon.com',
    phone: '+91 98201 10001',
    role: 'admin',
    branchId: 'BRN-2026-0001',
    assignedSiteIds: [],
    permissions: [],
    isActive: true,
    createdAt: baseDate,
    updatedAt: baseDate,
  };

  const branches: BranchRecord[] = [
    {
      branchId: 'BRN-2026-0001',
      branchName: 'Mumbai Corporate & Western Command',
      branchCode: 'MUM-HQ',
      managerName: 'Rajesh Sharma',
      mobile: '+91 98201 10001',
      email: 'mumbai.hq@rexonsecurity.com',
      address: '402, Heritage Corporate Plaza, Andheri East',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400069',
      status: 'Active',
      createdDate: '2026-01-15T09:00:00.000Z',
      updatedAt: '2026-04-10T09:00:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'BRANCH_CREATED', 'Initialized primary Mumbai HQ branch'),
      ],
    },
    {
      branchId: 'BRN-2026-0002',
      branchName: 'Pune Industrial & MIDC Division',
      branchCode: 'PUN-IND',
      managerName: 'Mahesh Deshmukh',
      mobile: '+91 98230 22014',
      email: 'pune.ops@rexonsecurity.com',
      address: 'Plot 18, Chakan Industrial Corridor, Pimpri-Chinchwad',
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '411019',
      status: 'Active',
      createdDate: '2026-02-04T10:30:00.000Z',
      updatedAt: '2026-04-12T11:00:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'BRANCH_CREATED', 'Created Pune Industrial operations branch'),
      ],
    },
    {
      branchId: 'BRN-2026-0003',
      branchName: 'Delhi NCR Northern Operations',
      branchCode: 'DEL-NCR',
      managerName: 'Karan Malhotra',
      mobile: '+91 98112 44090',
      email: 'ncr.ops@rexonsecurity.com',
      address: 'Tower B, Sector 62 Institutional Area',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pinCode: '201309',
      status: 'Active',
      createdDate: '2026-03-01T08:45:00.000Z',
      updatedAt: '2026-04-15T14:20:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'BRANCH_CREATED', 'Created Delhi NCR regional branch'),
      ],
    },
  ];

  const hrProfiles: HRProfileRecord[] = [
    {
      hrId: 'HR-2026-0001',
      uid: 'demo-hr-001',
      fullName: 'Priya Verma',
      email: 'hr@rexon.com',
      mobile: '+91 98201 10002',
      profilePhoto: '',
      assignedBranches: ['BRN-2026-0001', 'BRN-2026-0002'],
      hrDesignation: 'Senior HR',
      permissionProfile: 'Full Branch Operations',
      permissions: [...PERMISSION_PROFILE_MAP['Full Branch Operations']],
      joiningDate: '2026-01-20',
      accountStatus: 'Active',
      authProvisionMode: 'demo_preview',
      createdAt: '2026-01-20T09:30:00.000Z',
      updatedAt: '2026-04-10T09:30:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      history: [
        makeHistoryEntry(seedActor, 'HR_PROVISIONED', 'Assigned Senior HR across MUM-HQ and PUN-IND'),
      ],
    },
    {
      hrId: 'HR-2026-0002',
      uid: 'demo-hr-002',
      fullName: 'Rohan Kulkarni',
      email: 'rohan.hr@rexonsecurity.com',
      mobile: '+91 98231 55110',
      profilePhoto: '',
      assignedBranches: ['BRN-2026-0002'],
      hrDesignation: 'Branch HR',
      permissionProfile: 'Client & Site Coordinator',
      permissions: [...PERMISSION_PROFILE_MAP['Client & Site Coordinator']],
      joiningDate: '2026-02-12',
      accountStatus: 'Active',
      authProvisionMode: 'demo_preview',
      createdAt: '2026-02-12T10:00:00.000Z',
      updatedAt: '2026-04-11T10:00:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      history: [
        makeHistoryEntry(seedActor, 'HR_PROVISIONED', 'Assigned Branch HR for Pune Industrial'),
      ],
    },
    {
      hrId: 'HR-2026-0003',
      uid: 'demo-hr-003',
      fullName: 'Neha Joshi',
      email: 'accounts.hr@rexonsecurity.com',
      mobile: '+91 98114 88321',
      profilePhoto: '',
      assignedBranches: ['BRN-2026-0001', 'BRN-2026-0003'],
      hrDesignation: 'Accountant',
      permissionProfile: 'Accounts & Billing Only',
      permissions: [...PERMISSION_PROFILE_MAP['Accounts & Billing Only']],
      joiningDate: '2026-03-05',
      accountStatus: 'Active',
      authProvisionMode: 'demo_preview',
      createdAt: '2026-03-05T11:15:00.000Z',
      updatedAt: '2026-04-14T11:15:00.000Z',
      createdBy: 'Rajesh Sharma (Admin)',
      history: [
        makeHistoryEntry(seedActor, 'HR_PROVISIONED', 'Assigned Accountant billing profile'),
      ],
    },
  ];

  const clients: ClientRecord[] = [
    {
      clientId: 'CLT-2026-0001',
      companyName: 'Apex Precision Manufacturing Pvt Ltd',
      displayName: 'Apex Precision',
      companyType: 'Manufacturing Company',
      gstNumber: '27AABCA4512K1Z5',
      panNumber: 'AABCA4512K',
      registeredAddress: 'Plot D-44, MIDC Industrial Area, Chakan Phase II',
      state: 'Maharashtra',
      city: 'Pune',
      pinCode: '410501',
      contactPerson: 'Sandeep Deshpande',
      contactDesignation: 'VP — Plant Administration',
      mobile: '+91 98220 77410',
      alternateMobile: '+91 98220 77411',
      email: 'admin@apexprecision.in',
      billingAddress: 'Plot D-44, MIDC Industrial Area, Chakan Phase II, Pune 410501',
      billingContact: 'Meera Nair (Accounts Head)',
      contractStartDate: '2026-02-01',
      contractEndDate: '2027-01-31',
      paymentTerms: 'Net 30 Days',
      assignedBranch: 'BRN-2026-0002',
      clientStatus: 'Active',
      notes: '24x7 armed/unarmed gate security and plant housekeeping contract across 2 units.',
      createdBy: 'Priya Verma (Senior HR)',
      createdAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-04-10T10:00:00.000Z',
      isArchived: false,
      history: [
        makeHistoryEntry(seedActor, 'CLIENT_CREATED', 'Onboarded Apex Precision Manufacturing Pvt Ltd'),
      ],
    },
    {
      clientId: 'CLT-2026-0002',
      companyName: 'LifeCare Multispeciality Hospital Trust',
      displayName: 'LifeCare Hospital',
      companyType: 'Hospital',
      gstNumber: '27AABTL8821M1Z2',
      panNumber: 'AABTL8821M',
      registeredAddress: 'Link Road, Goregaon West',
      state: 'Maharashtra',
      city: 'Mumbai',
      pinCode: '400104',
      contactPerson: 'Dr. Kavita Menon',
      contactDesignation: 'Chief Operations Officer',
      mobile: '+91 98204 61200',
      alternateMobile: '',
      email: 'facilities@lifecarehospital.org',
      billingAddress: 'Finance Wing, 2nd Floor, LifeCare Hospital, Goregaon West, Mumbai 400104',
      billingContact: 'Harish Shetty',
      contractStartDate: '2026-01-15',
      contractEndDate: '2026-12-31',
      paymentTerms: '7th of Every Month',
      assignedBranch: 'BRN-2026-0001',
      clientStatus: 'Active',
      notes: 'Hospital lobby access control, emergency bay traffic marshals, and ward attendants.',
      createdBy: 'Priya Verma (Senior HR)',
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-04-08T12:00:00.000Z',
      isArchived: false,
      history: [
        makeHistoryEntry(seedActor, 'CLIENT_CREATED', 'Onboarded LifeCare Multispeciality Hospital'),
      ],
    },
    {
      clientId: 'CLT-2026-0003',
      companyName: 'Horizon Global TechPark LLP',
      displayName: 'Horizon TechPark',
      companyType: 'Corporate Office',
      gstNumber: '09AABFH3910P1Z8',
      panNumber: 'AABFH3910P',
      registeredAddress: 'Plot 7, Expressway IT Corridor, Sector 135',
      state: 'Uttar Pradesh',
      city: 'Noida',
      pinCode: '201304',
      contactPerson: 'Anurag Bansal',
      contactDesignation: 'Facility Director',
      mobile: '+91 98109 33120',
      alternateMobile: '+91 98109 33125',
      email: 'fm.desk@horizontechpark.com',
      billingAddress: 'Plot 7, Expressway IT Corridor, Sector 135, Noida 201304',
      billingContact: 'Anurag Bansal',
      contractStartDate: '2026-03-10',
      contractEndDate: '2027-03-09',
      paymentTerms: 'Net 15 Days',
      assignedBranch: 'BRN-2026-0003',
      clientStatus: 'Active',
      notes: 'Multi-tower IT campus perimeter security and boom-barrier operations.',
      createdBy: 'Rajesh Sharma (Admin)',
      createdAt: '2026-03-10T09:15:00.000Z',
      updatedAt: '2026-04-12T09:15:00.000Z',
      isArchived: false,
      history: [
        makeHistoryEntry(seedActor, 'CLIENT_CREATED', 'Onboarded Horizon Global TechPark LLP'),
      ],
    },
  ];

  const sites: SiteRecord[] = [
    {
      siteId: 'STE-2026-0001',
      siteName: 'Apex Chakan Assembly Plant — Unit 1',
      clientId: 'CLT-2026-0001',
      clientName: 'Apex Precision Manufacturing Pvt Ltd',
      branchId: 'BRN-2026-0002',
      siteType: 'Factory',
      fullAddress: 'Plot D-44, MIDC Chakan Phase II, Main Gate Complex',
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '410501',
      googleMapsLocation: '18.7606, 73.8636',
      siteContactPerson: 'Sandeep Deshpande',
      siteManagerName: 'Amit Patel',
      managerMobile: '+91 98201 10004',
      managerEmail: 'site@rexon.com',
      startDate: '2026-02-01',
      contractEndDate: '2027-01-31',
      siteStatus: 'Active',
      notes: '3 shifts · Weighbridge & material gate pass verification mandatory.',
      createdBy: 'Priya Verma (Senior HR)',
      createdAt: '2026-02-02T09:00:00.000Z',
      updatedAt: '2026-04-10T09:00:00.000Z',
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'SITE_CREATED', 'Registered Unit 1 Factory Site under CLT-2026-0001'),
      ],
    },
    {
      siteId: 'STE-2026-0002',
      siteName: 'Apex Central Logistics Warehouse — Unit 2',
      clientId: 'CLT-2026-0001',
      clientName: 'Apex Precision Manufacturing Pvt Ltd',
      branchId: 'BRN-2026-0002',
      siteType: 'Warehouse',
      fullAddress: 'Survey 92, Talegaon-Chakan Logistics Park',
      city: 'Pune',
      state: 'Maharashtra',
      pinCode: '410507',
      googleMapsLocation: '18.7352, 73.7814',
      siteContactPerson: 'Nitin Pawar',
      siteManagerName: 'Prakash Jadhav',
      managerMobile: '+91 98229 41008',
      managerEmail: 'warehouse.mgr@apexprecision.in',
      startDate: '2026-02-15',
      contractEndDate: '2027-01-31',
      siteStatus: 'Active',
      notes: 'Container dock security & CCTV control room monitoring.',
      createdBy: 'Priya Verma (Senior HR)',
      createdAt: '2026-02-15T11:30:00.000Z',
      updatedAt: '2026-04-11T11:30:00.000Z',
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'SITE_CREATED', 'Registered Unit 2 Warehouse Site under CLT-2026-0001'),
      ],
    },
    {
      siteId: 'STE-2026-0003',
      siteName: 'LifeCare Main Hospital Wing & Emergency Trauma Center',
      clientId: 'CLT-2026-0002',
      clientName: 'LifeCare Multispeciality Hospital Trust',
      branchId: 'BRN-2026-0001',
      siteType: 'Hospital',
      fullAddress: 'Link Road, Goregaon West, Opposite Metro Pillar 142',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400104',
      googleMapsLocation: '19.1663, 72.8426',
      siteContactPerson: 'Dr. Kavita Menon',
      siteManagerName: 'Sunil Sawant',
      managerMobile: '+91 98208 19320',
      managerEmail: 'security.desk@lifecarehospital.org',
      startDate: '2026-01-15',
      contractEndDate: '2026-12-31',
      siteStatus: 'Active',
      notes: 'Strict ICU visitor pass enforcement & ambulance lane clearance.',
      createdBy: 'Priya Verma (Senior HR)',
      createdAt: '2026-01-16T08:00:00.000Z',
      updatedAt: '2026-04-08T08:00:00.000Z',
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'SITE_CREATED', 'Registered Hospital Site under CLT-2026-0002'),
      ],
    },
    {
      siteId: 'STE-2026-0004',
      siteName: 'Horizon TechPark — Tower A & B Campus',
      clientId: 'CLT-2026-0003',
      clientName: 'Horizon Global TechPark LLP',
      branchId: 'BRN-2026-0003',
      siteType: 'Office',
      fullAddress: 'Plot 7, Sector 135 Expressway IT Corridor',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pinCode: '201304',
      googleMapsLocation: '28.4962, 77.4019',
      siteContactPerson: 'Anurag Bansal',
      siteManagerName: 'Deepak Tomar',
      managerMobile: '+91 98109 88412',
      managerEmail: 'tower.ops@horizontechpark.com',
      startDate: '2026-03-15',
      contractEndDate: '2027-03-09',
      siteStatus: 'Pending',
      notes: 'Additional night patrol deployment scheduled post fire-safety audit.',
      createdBy: 'Rajesh Sharma (Admin)',
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-04-12T10:00:00.000Z',
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      history: [
        makeHistoryEntry(seedActor, 'SITE_CREATED', 'Registered Campus Site under CLT-2026-0003'),
      ],
    },
  ];

  const { services, designations } = buildInitialServicesAndDesignations();
  const siteServices = buildInitialSiteServicesSeed();
  const approvals = buildInitialApprovalsSeed();
  const auditLogs = buildInitialAuditLogsSeed();

  return {
    branches,
    hrProfiles,
    clients,
    sites,
    services,
    designations,
    siteServices,
    approvals,
    auditLogs,
  };
}

/**
 * Reads local preview store and upgrades Phase 2 Part 1 stores seamlessly
 * so existing user-created Branches, HR accounts, Clients, and Sites are 100% preserved.
 */
function readLocalStore(): LocalMasterStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = buildInitialSeedStore();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }

    const parsed = JSON.parse(raw) as Partial<LocalMasterStore>;
    const defaults = buildInitialSeedStore();
    let migrated = false;

    const hrProfiles = Array.isArray(parsed.hrProfiles)
      ? parsed.hrProfiles.map((hr) => {
          const normalizedPerms = normalizePermissionList(hr.permissions || []);
          // Ensure upgraded Part 1 HR profiles also get service.view, designation.view, reports.view if coming from legacy presets
          if (
            hr.permissions?.some((p) => p.includes(':')) &&
            !normalizedPerms.includes('service.view')
          ) {
            migrated = true;
            const profileDefaults =
              PERMISSION_PROFILE_MAP[hr.permissionProfile] ?? normalizedPerms;
            return {
              ...hr,
              permissions: Array.from(new Set([...normalizedPerms, ...profileDefaults])),
            };
          }
          return { ...hr, permissions: normalizedPerms };
        })
      : defaults.hrProfiles;

    const services =
      Array.isArray(parsed.services) && parsed.services.length > 0
        ? parsed.services
        : ((migrated = true), defaults.services);

    const designations =
      Array.isArray(parsed.designations) && parsed.designations.length > 0
        ? parsed.designations
        : ((migrated = true), defaults.designations);

    const siteServices = Array.isArray(parsed.siteServices)
      ? parsed.siteServices.map((cfg) => ({
          ...cfg,
          vacantCount: computeNonNegativeVacancy(cfg.requiredCount, cfg.deployedCount),
        }))
      : ((migrated = true), defaults.siteServices);

    const approvals = Array.isArray(parsed.approvals)
      ? parsed.approvals
      : ((migrated = true), defaults.approvals);

    const auditLogs =
      Array.isArray(parsed.auditLogs) && parsed.auditLogs.length > 0
        ? parsed.auditLogs
        : ((migrated = true), defaults.auditLogs);

    const store: LocalMasterStore = {
      branches: Array.isArray(parsed.branches) ? parsed.branches : defaults.branches,
      hrProfiles,
      clients: Array.isArray(parsed.clients) ? parsed.clients : defaults.clients,
      sites: Array.isArray(parsed.sites) ? parsed.sites : defaults.sites,
      services,
      designations,
      siteServices,
      approvals,
      auditLogs,
    };

    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    return store;
  } catch {
    return buildInitialSeedStore();
  }
}

function writeLocalStore(store: LocalMasterStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
  notifyListeners();
}

function appendLocalAudit(
  store: LocalMasterStore,
  actor: RexonUser,
  params: {
    action: string;
    module: AuditModuleName;
    recordId: string;
    branchId: string;
    summary: string;
  }
): void {
  const logId = generateNextId(
    'AUD',
    store.auditLogs.map((l) => l.logId)
  );
  store.auditLogs.unshift(
    buildAuditLogObject(actor, {
      logId,
      ...params,
    })
  );
}

export async function recordExternalMasterAudit(
  actor: RexonUser,
  isPreviewSession: boolean,
  params: {
    action: string;
    module: AuditModuleName;
    recordId: string;
    branchId: string;
    summary: string;
  }
): Promise<void> {
  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    appendLocalAudit(store, actor, params);
    writeLocalStore(store);
    return;
  }
  const logId = makeRuntimeLogId();
  await setDoc(doc(firestoreDb!, 'auditLogs', logId), {
    ...buildAuditLogObject(actor, {
      logId,
      ...params,
    }),
    createdAt: serverTimestamp(),
  });
  notifyListeners();
}

function useLiveFirestore(isPreviewSession: boolean): boolean {
  return isFirebaseConfigured && Boolean(firestoreDb) && !isPreviewSession;
}

/**
 * Resolves live HR permission and branch assignments for Preview/Demo HR logins
 * so changes made by Admin in Permission Management immediately govern the HR user.
 */
export function resolvePreviewHRUserOverlay(baseUser: RexonUser): {
  user: RexonUser;
  accountStatus: HRAccountStatus;
} {
  if (baseUser.role !== 'hr') {
    return { user: baseUser, accountStatus: 'Active' };
  }
  const store = readLocalStore();
  const matched = store.hrProfiles.find(
    (h) =>
      h.uid === baseUser.uid ||
      h.email.trim().toLowerCase() === baseUser.email.trim().toLowerCase()
  );
  if (!matched) {
    return { user: baseUser, accountStatus: 'Active' };
  }
  const assignedBranches =
    matched.assignedBranches.length > 0 ? matched.assignedBranches : [baseUser.branchId];
  return {
    accountStatus: matched.accountStatus,
    user: {
      ...baseUser,
      fullName: `${matched.fullName} (${matched.hrDesignation})`,
      phone: matched.mobile || baseUser.phone,
      branchId: assignedBranches[0] || baseUser.branchId,
      assignedBranches,
      permissions: normalizePermissionList(matched.permissions),
      isActive: matched.accountStatus === 'Active',
    },
  };
}

// ============================================================================
// 1. BRANCH SERVICES (ADMIN ONLY — OR HR WITH `branch.view` / `branch.manage`)
// ============================================================================
export async function listBranches(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<BranchRecord[]> {
  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    if (caller.role === 'admin') {
      return [...store.branches].sort((a, b) => b.createdDate.localeCompare(a.createdDate));
    }
    const allowed = getAuthorizedBranchIds(caller);
    return store.branches.filter((b) => !b.isDeleted && allowed.includes(b.branchId));
  }

  const path = 'branches';
  try {
    const allowedBranches = getAuthorizedBranchIds(caller);
    if (caller.role !== 'admin' && allowedBranches.length === 0) {
      return [];
    }
    const q =
      caller.role === 'admin'
        ? query(collection(firestoreDb!, path))
        : query(
            collection(firestoreDb!, path),
            where('branchId', 'in', allowedBranches.slice(0, 10))
          );
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => d.data() as BranchRecord);
    return items.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createBranchRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: BranchFormInput
): Promise<BranchRecord> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can create Branch records.');
  }

  const existing = await listBranches(caller, isPreviewSession);
  const validation = validateBranchForm(input, existing);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Branch validation failed.');
  }

  const branchId = generateNextId(
    'BRN',
    existing.map((b) => b.branchId)
  );
  const nowIso = new Date().toISOString();

  const record: BranchRecord = {
    branchId,
    branchName: sanitizeInput(input.branchName, 120),
    branchCode: normalizeCode(input.branchCode),
    managerName: sanitizeInput(input.managerName, 100),
    mobile: sanitizeInput(input.mobile, 20),
    email: sanitizeInput(input.email.toLowerCase(), 160),
    address: sanitizeInput(input.address, 250),
    city: sanitizeInput(input.city, 80),
    state: sanitizeInput(input.state, 80),
    pinCode: sanitizeInput(input.pinCode, 10),
    status: input.status,
    createdDate: nowIso,
    updatedAt: nowIso,
    createdBy: `${caller.fullName} (${caller.role})`,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    history: [
      makeHistoryEntry(
        caller,
        'BRANCH_CREATED',
        `Created branch ${normalizeCode(input.branchCode)} (${input.city})`
      ),
    ],
  };

  const summary = `Created Branch ${record.branchCode} — ${record.branchName} (${record.city}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.branches.unshift(record);
    appendLocalAudit(store, caller, {
      action: 'Branch Created',
      module: 'Branch',
      recordId: branchId,
      branchId,
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `branches/${branchId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'branches', branchId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Branch Created',
        module: 'Branch',
        recordId: branchId,
        branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateBranchRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  branchId: string,
  input: BranchFormInput
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can edit Branch records.');
  }

  const existing = await listBranches(caller, isPreviewSession);
  const validation = validateBranchForm(input, existing, branchId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Branch validation failed.');
  }

  const nowIso = new Date().toISOString();
  const summary = `Updated Branch ${normalizeCode(input.branchCode)} (${input.branchName}) · Status: ${input.status}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.branches = store.branches.map((b) => {
      if (b.branchId !== branchId) return b;
      return {
        ...b,
        branchName: sanitizeInput(input.branchName, 120),
        branchCode: normalizeCode(input.branchCode),
        managerName: sanitizeInput(input.managerName, 100),
        mobile: sanitizeInput(input.mobile, 20),
        email: sanitizeInput(input.email.toLowerCase(), 160),
        address: sanitizeInput(input.address, 250),
        city: sanitizeInput(input.city, 80),
        state: sanitizeInput(input.state, 80),
        pinCode: sanitizeInput(input.pinCode, 10),
        status: input.status,
        updatedAt: nowIso,
        history: [
          makeHistoryEntry(caller, 'BRANCH_UPDATED', `Updated branch details (${input.branchCode})`),
          ...b.history,
        ],
      };
    });
    appendLocalAudit(store, caller, {
      action: 'Branch Updated',
      module: 'Branch',
      recordId: branchId,
      branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `branches/${branchId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'branches', branchId), {
      branchName: sanitizeInput(input.branchName, 120),
      branchCode: normalizeCode(input.branchCode),
      managerName: sanitizeInput(input.managerName, 100),
      mobile: sanitizeInput(input.mobile, 20),
      email: sanitizeInput(input.email.toLowerCase(), 160),
      address: sanitizeInput(input.address, 250),
      city: sanitizeInput(input.city, 80),
      state: sanitizeInput(input.state, 80),
      pinCode: sanitizeInput(input.pinCode, 10),
      status: input.status,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Branch Updated',
        module: 'Branch',
        recordId: branchId,
        branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleBranchStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  branchId: string,
  nextStatus: BranchStatus
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can activate or deactivate Branches.');
  }
  const nowIso = new Date().toISOString();
  const summary = `Changed Branch ${branchId} status to ${nextStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.branches = store.branches.map((b) =>
      b.branchId === branchId
        ? {
            ...b,
            status: nextStatus,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(caller, 'STATUS_CHANGED', `Changed status to ${nextStatus}`),
              ...b.history,
            ],
          }
        : b
    );
    appendLocalAudit(store, caller, {
      action: 'Branch Updated',
      module: 'Branch',
      recordId: branchId,
      branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `branches/${branchId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'branches', branchId), {
      status: nextStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Branch Updated',
        module: 'Branch',
        recordId: branchId,
        branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function softDeleteBranchRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  branchId: string
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can soft-delete Branches.');
  }
  const nowIso = new Date().toISOString();
  const summary = `Soft-deleted Branch ${branchId}; historical records preserved.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.branches = store.branches.map((b) =>
      b.branchId === branchId
        ? {
            ...b,
            status: 'Inactive',
            isDeleted: true,
            deletedAt: nowIso,
            deletedBy: `${caller.fullName} (${caller.uid})`,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(
                caller,
                'BRANCH_SOFT_DELETED',
                'Soft-deleted branch; historical records preserved'
              ),
              ...b.history,
            ],
          }
        : b
    );
    appendLocalAudit(store, caller, {
      action: 'Branch Updated',
      module: 'Branch',
      recordId: branchId,
      branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `branches/${branchId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'branches', branchId), {
      status: 'Inactive',
      isDeleted: true,
      deletedAt: nowIso,
      deletedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Branch Updated',
        module: 'Branch',
        recordId: branchId,
        branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 2. HR ACCOUNT & GRANULAR PERMISSION MANAGEMENT (ADMIN ONLY)
// ============================================================================
export async function uploadHRProfilePhoto(
  hrId: string,
  file: File,
  isPreviewSession: boolean
): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Profile photo must be a JPG, PNG, or WebP image.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Profile photo must be 2 MB or smaller.');
  }

  if (useLiveFirestore(isPreviewSession) && firebaseStorage) {
    const storagePath = `hr_profiles/${hrId}/avatar_${Date.now()}`;
    const storageRef = ref(firebaseStorage, storagePath);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return await getDownloadURL(storageRef);
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read selected profile image.'));
    reader.readAsDataURL(file);
  });
}

export async function listHRProfiles(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<HRProfileRecord[]> {
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'hr.view')) {
    return [];
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    return [...store.hrProfiles].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'hrProfiles';
  try {
    const snap = await getDocs(collection(firestoreDb!, path));
    return snap.docs
      .map((d) => d.data() as HRProfileRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export interface CreateHRAccountOutcome {
  record: HRProfileRecord;
  provisioningNote: string;
}

export async function createHRProfileAccount(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: HRProfileFormInput,
  photoFile?: File | null
): Promise<CreateHRAccountOutcome> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can provision HR accounts.');
  }

  const existing = await listHRProfiles(caller, isPreviewSession);
  const validation = validateHRProfileForm(input, existing);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'HR profile validation failed.');
  }

  const hrId = generateNextId(
    'HR',
    existing.map((h) => h.hrId)
  );
  const permissions = [
    ...(PERMISSION_PROFILE_MAP[input.permissionProfile] ?? ['client.view', 'site.view']),
  ];
  const nowIso = new Date().toISOString();

  let photoUrl = input.profilePhoto || '';
  if (photoFile) {
    photoUrl = await uploadHRProfilePhoto(hrId, photoFile, isPreviewSession);
  }

  let provisionedUid = `pending-auth-${hrId.toLowerCase()}`;
  let provisioningNote =
    'Demo Mode: HR profile saved locally without storing any password. Connect Firebase + Backend Admin SDK to dispatch live Auth setup emails.';

  if (useLiveFirestore(isPreviewSession) && firebaseAuth?.currentUser) {
    const idToken = await firebaseAuth.currentUser.getIdToken();
    const response = await fetch('/api/admin/hr-accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        hrId,
        fullName: sanitizeInput(input.fullName, 120),
        email: sanitizeInput(input.email.toLowerCase(), 160),
        mobile: sanitizeInput(input.mobile, 20),
        assignedBranches: input.assignedBranches,
        hrDesignation: input.hrDesignation,
        permissionProfile: input.permissionProfile,
        permissions,
        joiningDate: input.joiningDate,
        accountStatus: input.accountStatus,
      }),
    });

    if (response.ok) {
      const body = (await response.json()) as { uid?: string };
      if (body.uid) {
        provisionedUid = body.uid;
      }
      try {
        await sendPasswordResetEmail(firebaseAuth, input.email.trim());
        provisioningNote = `Firebase Auth user provisioned via trusted backend (${provisionedUid}) and password-setup email dispatched to ${input.email.trim()}.`;
      } catch {
        provisioningNote = `Firebase Auth user provisioned (${provisionedUid}) via trusted backend.`;
      }
    } else {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string };
      provisioningNote =
        errBody.error ||
        'HR Master Profile saved in Firestore. Configure server-side Cloud Function / Admin SDK to complete Firebase Auth user creation.';
    }
  }

  const record: HRProfileRecord = {
    hrId,
    uid: provisionedUid,
    fullName: sanitizeInput(input.fullName, 120),
    email: sanitizeInput(input.email.toLowerCase(), 160),
    mobile: sanitizeInput(input.mobile, 20),
    profilePhoto: photoUrl,
    assignedBranches: input.assignedBranches,
    hrDesignation: input.hrDesignation,
    permissionProfile: input.permissionProfile,
    permissions,
    joiningDate: input.joiningDate,
    accountStatus: input.accountStatus,
    authProvisionMode: useLiveFirestore(isPreviewSession) ? 'firebase_backend' : 'demo_preview',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: `${caller.fullName} (${caller.role})`,
    history: [
      makeHistoryEntry(
        caller,
        'HR_CREATED',
        `Created ${input.hrDesignation} profile (${input.permissionProfile})`
      ),
    ],
  };

  const summary = `Created HR account ${hrId} (${record.fullName} · ${record.hrDesignation}) assigned to ${input.assignedBranches.join(', ')}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.hrProfiles.unshift(record);
    appendLocalAudit(store, caller, {
      action: 'HR Created',
      module: 'HR',
      recordId: hrId,
      branchId: input.assignedBranches[0] || caller.branchId,
      summary,
    });
    writeLocalStore(store);
    return { record, provisioningNote };
  }

  const path = `hrProfiles/${hrId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'hrProfiles', hrId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'HR Created',
        module: 'HR',
        recordId: hrId,
        branchId: input.assignedBranches[0] || caller.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return { record, provisioningNote };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateHRProfileAccount(
  caller: RexonUser,
  isPreviewSession: boolean,
  hrId: string,
  input: HRProfileFormInput,
  photoFile?: File | null
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can update HR accounts.');
  }

  const existingProfiles = await listHRProfiles(caller, isPreviewSession);
  const validation = validateHRProfileForm(input, existingProfiles, hrId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'HR profile validation failed.');
  }

  let photoUrl = input.profilePhoto || '';
  if (photoFile) {
    photoUrl = await uploadHRProfilePhoto(hrId, photoFile, isPreviewSession);
  }

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const existingProfile = store.hrProfiles.find((h) => h.hrId === hrId);
    const resolvedPermissions =
      input.permissionProfile === 'Custom Granular Profile' && existingProfile
        ? existingProfile.permissions
        : [...(PERMISSION_PROFILE_MAP[input.permissionProfile] ?? ['client.view', 'site.view'])];

    store.hrProfiles = store.hrProfiles.map((h) =>
      h.hrId === hrId
        ? {
            ...h,
            fullName: sanitizeInput(input.fullName, 120),
            email: sanitizeInput(input.email.toLowerCase(), 160),
            mobile: sanitizeInput(input.mobile, 20),
            profilePhoto: photoUrl,
            assignedBranches: input.assignedBranches,
            hrDesignation: input.hrDesignation,
            permissionProfile: input.permissionProfile,
            permissions: resolvedPermissions,
            joiningDate: input.joiningDate,
            accountStatus: input.accountStatus,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(
                caller,
                'HR_UPDATED',
                `Updated designation/profile (${input.hrDesignation} · ${input.permissionProfile})`
              ),
              ...h.history,
            ],
          }
        : h
    );
    appendLocalAudit(store, caller, {
      action: 'HR Updated',
      module: 'HR',
      recordId: hrId,
      branchId: input.assignedBranches[0] || caller.branchId,
      summary: `Updated HR profile ${hrId} (${input.fullName} · ${input.hrDesignation}).`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `hrProfiles/${hrId}`;
  try {
    const snap = await getDoc(doc(firestoreDb!, 'hrProfiles', hrId));
    const current = snap.exists() ? (snap.data() as HRProfileRecord) : null;
    const resolvedPermissions =
      input.permissionProfile === 'Custom Granular Profile' && current
        ? current.permissions
        : [...(PERMISSION_PROFILE_MAP[input.permissionProfile] ?? ['client.view', 'site.view'])];

    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'hrProfiles', hrId), {
      fullName: sanitizeInput(input.fullName, 120),
      email: sanitizeInput(input.email.toLowerCase(), 160),
      mobile: sanitizeInput(input.mobile, 20),
      profilePhoto: photoUrl,
      assignedBranches: input.assignedBranches,
      hrDesignation: input.hrDesignation,
      permissionProfile: input.permissionProfile,
      permissions: resolvedPermissions,
      joiningDate: input.joiningDate,
      accountStatus: input.accountStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });

    if (current?.uid && !current.uid.startsWith('pending-auth-')) {
      const userRef = doc(firestoreDb!, 'users', current.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        batch.update(userRef, {
          fullName: sanitizeInput(input.fullName, 120),
          phone: sanitizeInput(input.mobile, 20),
          branchId: input.assignedBranches[0] || current.assignedBranches[0],
          assignedBranches: input.assignedBranches,
          permissions: resolvedPermissions,
          isActive: input.accountStatus === 'Active',
          updatedAt: nowIso,
        });
      }
    }

    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'HR Updated',
        module: 'HR',
        recordId: hrId,
        branchId: input.assignedBranches[0] || caller.branchId,
        summary: `Updated HR profile ${hrId} (${input.fullName} · ${input.hrDesignation}).`,
      }),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateHRAccountStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  hrId: string,
  nextStatus: HRAccountStatus
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can change HR account status.');
  }
  const nowIso = new Date().toISOString();
  const summary = `Changed HR account ${hrId} status to ${nextStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.hrProfiles = store.hrProfiles.map((h) =>
      h.hrId === hrId
        ? {
            ...h,
            accountStatus: nextStatus,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(caller, 'HR_STATUS_CHANGED', `Changed status to ${nextStatus}`),
              ...h.history,
            ],
          }
        : h
    );
    appendLocalAudit(store, caller, {
      action: 'HR Updated',
      module: 'HR',
      recordId: hrId,
      branchId: caller.branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `hrProfiles/${hrId}`;
  try {
    const hrRef = doc(firestoreDb!, 'hrProfiles', hrId);
    const hrSnap = await getDoc(hrRef);
    const target = hrSnap.exists() ? (hrSnap.data() as HRProfileRecord) : null;

    const batch = writeBatch(firestoreDb!);
    batch.update(hrRef, {
      accountStatus: nextStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });

    if (target?.uid && !target.uid.startsWith('pending-auth-')) {
      const userRef = doc(firestoreDb!, 'users', target.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        batch.update(userRef, {
          isActive: nextStatus === 'Active',
          updatedAt: nowIso,
        });
      }
    }

    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'HR Updated',
        module: 'HR',
        recordId: hrId,
        branchId: target?.assignedBranches?.[0] || caller.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateHRPermissionsAndScope(
  caller: RexonUser,
  isPreviewSession: boolean,
  hrId: string,
  payload: {
    permissionProfile: PermissionProfileName;
    permissions: string[];
    assignedBranches: string[];
  }
): Promise<void> {
  if (caller.role !== 'admin') {
    throw new Error('Only Administrators can assign or modify HR permissions.');
  }
  if (!payload.assignedBranches || payload.assignedBranches.length === 0) {
    throw new Error('At least one Assigned Branch is required for an HR account.');
  }

  const allowedSet = new Set<string>(HR_PERMISSIONS);
  const validatedPerms = Array.from(
    new Set(payload.permissions.filter((p) => allowedSet.has(p)))
  );

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.hrProfiles.find((h) => h.hrId === hrId);
    if (!target) {
      throw new Error(`HR profile ${hrId} not found.`);
    }

    store.hrProfiles = store.hrProfiles.map((h) =>
      h.hrId === hrId
        ? {
            ...h,
            permissionProfile: payload.permissionProfile,
            permissions: validatedPerms,
            assignedBranches: payload.assignedBranches,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(
                caller,
                'PERMISSION_CHANGED',
                `Assigned ${validatedPerms.length} permissions across ${payload.assignedBranches.join(', ')}`
              ),
              ...h.history,
            ],
          }
        : h
    );

    appendLocalAudit(store, caller, {
      action: 'Permission Changed',
      module: 'Permissions',
      recordId: hrId,
      branchId: payload.assignedBranches[0] || caller.branchId,
      summary: `Updated permissions for ${target.fullName} (${hrId}): ${validatedPerms.length} permission(s) across branch(es) ${payload.assignedBranches.join(', ')}.`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `hrProfiles/${hrId}`;
  try {
    const hrRef = doc(firestoreDb!, 'hrProfiles', hrId);
    const hrSnap = await getDoc(hrRef);
    if (!hrSnap.exists()) {
      throw new Error(`HR profile ${hrId} not found in Firestore.`);
    }
    const target = hrSnap.data() as HRProfileRecord;

    if (firebaseAuth?.currentUser) {
      const idToken = await firebaseAuth.currentUser.getIdToken();
      await fetch('/api/admin/hr-permissions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          hrId,
          uid: target.uid,
          permissionProfile: payload.permissionProfile,
          permissions: validatedPerms,
          assignedBranches: payload.assignedBranches,
        }),
      }).catch(() => undefined);
    }

    const batch = writeBatch(firestoreDb!);
    batch.update(hrRef, {
      permissionProfile: payload.permissionProfile,
      permissions: validatedPerms,
      assignedBranches: payload.assignedBranches,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });

    if (target.uid && !target.uid.startsWith('pending-auth-')) {
      const userRef = doc(firestoreDb!, 'users', target.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        batch.update(userRef, {
          branchId: payload.assignedBranches[0],
          assignedBranches: payload.assignedBranches,
          permissions: validatedPerms,
          updatedAt: nowIso,
        });
      }
    }

    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Permission Changed',
        module: 'Permissions',
        recordId: hrId,
        branchId: payload.assignedBranches[0] || caller.branchId,
        summary: `Updated permissions for ${target.fullName} (${hrId}): ${validatedPerms.length} permission(s) across branch(es) ${payload.assignedBranches.join(', ')}.`,
      }),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 3. CLIENT MANAGEMENT SERVICES (HR WITHIN PERMISSIONS & ADMIN ALL)
// ============================================================================
export async function listClients(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<ClientRecord[]> {
  if (caller.role !== 'admin' && !hasUserPermission(caller, 'client.view')) {
    return [];
  }
  const authorizedBranches = getAuthorizedBranchIds(caller);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const filtered =
      caller.role === 'admin'
        ? store.clients
        : store.clients.filter(
            (c) => !c.isArchived && authorizedBranches.includes(c.assignedBranch)
          );
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'clients';
  try {
    if (caller.role !== 'admin' && authorizedBranches.length === 0) {
      return [];
    }
    const q =
      caller.role === 'admin'
        ? query(collection(firestoreDb!, path))
        : query(
            collection(firestoreDb!, path),
            where('assignedBranch', 'in', authorizedBranches.slice(0, 10))
          );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as ClientRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createClientRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: ClientFormInput
): Promise<ClientRecord> {
  if (!hasUserPermission(caller, 'client.create')) {
    throw new Error('Your HR permission profile does not grant Client creation access (client.create).');
  }

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.assignedBranch)) {
    throw new Error('You can only register Clients under your assigned branch(es).');
  }

  const storeSnapshot = !useLiveFirestore(isPreviewSession)
    ? readLocalStore().clients
    : await listClients(caller, isPreviewSession);

  const validation = validateClientForm(input, storeSnapshot);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Client validation failed.');
  }

  const clientId = generateNextId(
    'CLT',
    storeSnapshot.map((c) => c.clientId)
  );
  const nowIso = new Date().toISOString();

  const record: ClientRecord = {
    clientId,
    companyName: sanitizeInput(input.companyName, 150),
    displayName: sanitizeInput(input.displayName, 100),
    companyType: input.companyType,
    gstNumber: normalizeCode(input.gstNumber) || 'UNREGISTERED',
    panNumber: normalizeCode(input.panNumber),
    registeredAddress: sanitizeInput(input.registeredAddress, 300),
    state: sanitizeInput(input.state, 80),
    city: sanitizeInput(input.city, 80),
    pinCode: sanitizeInput(input.pinCode, 10),
    contactPerson: sanitizeInput(input.contactPerson, 100),
    contactDesignation: sanitizeInput(input.contactDesignation, 80),
    mobile: sanitizeInput(input.mobile, 20),
    alternateMobile: sanitizeInput(input.alternateMobile, 20),
    email: sanitizeInput(input.email.toLowerCase(), 160),
    billingAddress: sanitizeInput(input.billingAddress, 300),
    billingContact: sanitizeInput(input.billingContact, 100),
    contractStartDate: input.contractStartDate,
    contractEndDate: input.contractEndDate,
    paymentTerms: sanitizeInput(input.paymentTerms, 80),
    assignedBranch: input.assignedBranch,
    clientStatus: input.clientStatus,
    notes: sanitizeInput(input.notes, 500),
    createdBy: `${caller.fullName} (${caller.role})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    isArchived: false,
    history: [
      makeHistoryEntry(
        caller,
        'CLIENT_CREATED',
        `Registered client ${input.companyName} under branch ${input.assignedBranch}`
      ),
    ],
  };

  const summary = `Created Client ${clientId} (${record.companyName}) under branch ${record.assignedBranch}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.clients.unshift(record);
    appendLocalAudit(store, caller, {
      action: 'Client Created',
      module: 'Client',
      recordId: clientId,
      branchId: record.assignedBranch,
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `clients/${clientId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'clients', clientId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Client Created',
        module: 'Client',
        recordId: clientId,
        branchId: record.assignedBranch,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateClientRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  clientId: string,
  input: ClientFormInput
): Promise<void> {
  if (!hasUserPermission(caller, 'client.edit')) {
    throw new Error('Your HR permission profile does not grant Client edit access (client.edit).');
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.assignedBranch)) {
    throw new Error('You cannot transfer or edit Clients outside your assigned branch(es).');
  }

  const existingClients = !useLiveFirestore(isPreviewSession)
    ? readLocalStore().clients
    : await listClients(caller, isPreviewSession);
  const validation = validateClientForm(input, existingClients, clientId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Client validation failed.');
  }

  const nowIso = new Date().toISOString();
  const summary = `Updated Client ${clientId} (${input.displayName}) · Status: ${input.clientStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.clients = store.clients.map((c) => {
      if (c.clientId !== clientId) return c;
      return {
        ...c,
        companyName: sanitizeInput(input.companyName, 150),
        displayName: sanitizeInput(input.displayName, 100),
        companyType: input.companyType,
        gstNumber: normalizeCode(input.gstNumber) || 'UNREGISTERED',
        panNumber: normalizeCode(input.panNumber),
        registeredAddress: sanitizeInput(input.registeredAddress, 300),
        state: sanitizeInput(input.state, 80),
        city: sanitizeInput(input.city, 80),
        pinCode: sanitizeInput(input.pinCode, 10),
        contactPerson: sanitizeInput(input.contactPerson, 100),
        contactDesignation: sanitizeInput(input.contactDesignation, 80),
        mobile: sanitizeInput(input.mobile, 20),
        alternateMobile: sanitizeInput(input.alternateMobile, 20),
        email: sanitizeInput(input.email.toLowerCase(), 160),
        billingAddress: sanitizeInput(input.billingAddress, 300),
        billingContact: sanitizeInput(input.billingContact, 100),
        contractStartDate: input.contractStartDate,
        contractEndDate: input.contractEndDate,
        paymentTerms: sanitizeInput(input.paymentTerms, 80),
        assignedBranch: input.assignedBranch,
        clientStatus: input.clientStatus,
        notes: sanitizeInput(input.notes, 500),
        updatedAt: nowIso,
        history: [
          makeHistoryEntry(caller, 'CLIENT_UPDATED', `Updated client ${input.displayName}`),
          ...c.history,
        ],
      };
    });
    store.sites = store.sites.map((s) =>
      s.clientId === clientId
        ? { ...s, clientName: sanitizeInput(input.companyName, 150) }
        : s
    );
    appendLocalAudit(store, caller, {
      action: 'Client Updated',
      module: 'Client',
      recordId: clientId,
      branchId: input.assignedBranch,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `clients/${clientId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'clients', clientId), {
      companyName: sanitizeInput(input.companyName, 150),
      displayName: sanitizeInput(input.displayName, 100),
      companyType: input.companyType,
      gstNumber: normalizeCode(input.gstNumber) || 'UNREGISTERED',
      panNumber: normalizeCode(input.panNumber),
      registeredAddress: sanitizeInput(input.registeredAddress, 300),
      state: sanitizeInput(input.state, 80),
      city: sanitizeInput(input.city, 80),
      pinCode: sanitizeInput(input.pinCode, 10),
      contactPerson: sanitizeInput(input.contactPerson, 100),
      contactDesignation: sanitizeInput(input.contactDesignation, 80),
      mobile: sanitizeInput(input.mobile, 20),
      alternateMobile: sanitizeInput(input.alternateMobile, 20),
      email: sanitizeInput(input.email.toLowerCase(), 160),
      billingAddress: sanitizeInput(input.billingAddress, 300),
      billingContact: sanitizeInput(input.billingContact, 100),
      contractStartDate: input.contractStartDate,
      contractEndDate: input.contractEndDate,
      paymentTerms: sanitizeInput(input.paymentTerms, 80),
      assignedBranch: input.assignedBranch,
      clientStatus: input.clientStatus,
      notes: sanitizeInput(input.notes, 500),
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Client Updated',
        module: 'Client',
        recordId: clientId,
        branchId: input.assignedBranch,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function archiveClientRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  clientId: string
): Promise<void> {
  if (!hasUserPermission(caller, 'client.delete')) {
    throw new Error(
      'Direct Client archival requires Admin access or client.delete permission. Submit an Admin Approval request instead.'
    );
  }

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.clients.find((c) => c.clientId === clientId);
    if (!target) throw new Error(`Client ${clientId} not found.`);
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.assignedBranch)) {
      throw new Error('Unauthorized branch scope for Client archival.');
    }

    store.clients = store.clients.map((c) =>
      c.clientId === clientId
        ? {
            ...c,
            clientStatus: 'Inactive',
            isArchived: true,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(caller, 'CLIENT_ARCHIVED', 'Archived client record; historical sites preserved'),
              ...c.history,
            ],
          }
        : c
    );
    appendLocalAudit(store, caller, {
      action: 'Client Updated',
      module: 'Client',
      recordId: clientId,
      branchId: target.assignedBranch,
      summary: `Archived Client ${clientId} (${target.companyName}); historical records retained.`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `clients/${clientId}`;
  try {
    const clientRef = doc(firestoreDb!, 'clients', clientId);
    const snap = await getDoc(clientRef);
    const target = snap.exists() ? (snap.data() as ClientRecord) : null;
    const branchId = target?.assignedBranch || caller.branchId;

    const batch = writeBatch(firestoreDb!);
    batch.update(clientRef, {
      clientStatus: 'Inactive',
      isArchived: true,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Client Updated',
        module: 'Client',
        recordId: clientId,
        branchId,
        summary: `Archived Client ${clientId} (${target?.companyName ?? clientId}); historical records retained.`,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 4. SITE MANAGEMENT SERVICES (EVERY SITE BELONGS TO ONE CLIENT; HISTORICAL SAFE)
// ============================================================================
export async function listSites(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<SiteRecord[]> {
  if (caller.role === 'hr' && !hasUserPermission(caller, 'site.view')) {
    return [];
  }
  const authorizedBranches = getAuthorizedBranchIds(caller);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const filtered =
      caller.role === 'admin'
        ? store.sites
        : caller.role === 'hr'
          ? store.sites.filter(
              (s) => !s.isArchived && authorizedBranches.includes(s.branchId)
            )
          : store.sites.filter(
              (s) => !s.isArchived && caller.assignedSiteIds.includes(s.siteId)
            );
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'sites';
  try {
    let q;
    if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    }
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as SiteRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createSiteRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: SiteFormInput
): Promise<SiteRecord> {
  if (!hasUserPermission(caller, 'site.create')) {
    throw new Error('Your HR permission profile does not grant Site creation access (site.create).');
  }

  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('You can only create Sites under your assigned branch(es).');
  }

  const allExisting = !useLiveFirestore(isPreviewSession)
    ? readLocalStore().sites
    : await listSites(caller, isPreviewSession);

  const validation = validateSiteForm(input, allExisting);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Site validation failed.');
  }

  const siteId = generateNextId(
    'STE',
    allExisting.map((s) => s.siteId)
  );
  const nowIso = new Date().toISOString();

  const record: SiteRecord = {
    siteId,
    siteName: sanitizeInput(input.siteName, 140),
    clientId: input.clientId,
    clientName: sanitizeInput(input.clientName, 150),
    branchId: input.branchId,
    siteType: input.siteType,
    fullAddress: sanitizeInput(input.fullAddress, 300),
    city: sanitizeInput(input.city, 80),
    state: sanitizeInput(input.state, 80),
    pinCode: sanitizeInput(input.pinCode, 10),
    googleMapsLocation: sanitizeInput(input.googleMapsLocation, 250),
    siteContactPerson: sanitizeInput(input.siteContactPerson, 100),
    siteManagerName: sanitizeInput(input.siteManagerName, 100),
    managerMobile: sanitizeInput(input.managerMobile, 20),
    managerEmail: sanitizeInput(input.managerEmail.toLowerCase(), 160),
    startDate: input.startDate,
    contractEndDate: input.contractEndDate,
    siteStatus: input.siteStatus,
    notes: sanitizeInput(input.notes, 500),
    createdBy: `${caller.fullName} (${caller.role})`,
    createdAt: nowIso,
    updatedAt: nowIso,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    history: [
      makeHistoryEntry(
        caller,
        'SITE_CREATED',
        `Created site "${input.siteName}" linked to client ${input.clientName} (${input.clientId})`
      ),
    ],
  };

  const summary = `Created Site ${siteId} (${record.siteName}) under Client ${record.clientName} (${record.clientId}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.sites.unshift(record);
    appendLocalAudit(store, caller, {
      action: 'Site Created',
      module: 'Site',
      recordId: siteId,
      branchId: record.branchId,
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `sites/${siteId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'sites', siteId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Created',
        module: 'Site',
        recordId: siteId,
        branchId: record.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSiteRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId: string,
  input: SiteFormInput
): Promise<void> {
  if (!hasUserPermission(caller, 'site.edit')) {
    throw new Error('Your HR permission profile does not grant Site edit access (site.edit).');
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('You cannot update Sites outside your assigned branch(es).');
  }

  const existingSites = !useLiveFirestore(isPreviewSession)
    ? readLocalStore().sites
    : await listSites(caller, isPreviewSession);
  const validation = validateSiteForm(input, existingSites, siteId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Site validation failed.');
  }

  const nowIso = new Date().toISOString();
  const summary = `Updated Site ${siteId} (${input.siteName}) · Status: ${input.siteStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.sites = store.sites.map((s) =>
      s.siteId === siteId
        ? {
            ...s,
            siteName: sanitizeInput(input.siteName, 140),
            clientId: input.clientId,
            clientName: sanitizeInput(input.clientName, 150),
            branchId: input.branchId,
            siteType: input.siteType,
            fullAddress: sanitizeInput(input.fullAddress, 300),
            city: sanitizeInput(input.city, 80),
            state: sanitizeInput(input.state, 80),
            pinCode: sanitizeInput(input.pinCode, 10),
            googleMapsLocation: sanitizeInput(input.googleMapsLocation, 250),
            siteContactPerson: sanitizeInput(input.siteContactPerson, 100),
            siteManagerName: sanitizeInput(input.siteManagerName, 100),
            managerMobile: sanitizeInput(input.managerMobile, 20),
            managerEmail: sanitizeInput(input.managerEmail.toLowerCase(), 160),
            startDate: input.startDate,
            contractEndDate: input.contractEndDate,
            siteStatus: input.siteStatus,
            notes: sanitizeInput(input.notes, 500),
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(
                caller,
                'SITE_UPDATED',
                `Updated site details / status (${input.siteStatus})`
              ),
              ...s.history,
            ],
          }
        : s
    );
    store.siteServices = store.siteServices.map((cfg) =>
      cfg.siteId === siteId
        ? { ...cfg, siteName: sanitizeInput(input.siteName, 140), branchId: input.branchId }
        : cfg
    );
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'Site',
      recordId: siteId,
      branchId: input.branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `sites/${siteId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'sites', siteId), {
      siteName: sanitizeInput(input.siteName, 140),
      clientId: input.clientId,
      clientName: sanitizeInput(input.clientName, 150),
      branchId: input.branchId,
      siteType: input.siteType,
      fullAddress: sanitizeInput(input.fullAddress, 300),
      city: sanitizeInput(input.city, 80),
      state: sanitizeInput(input.state, 80),
      pinCode: sanitizeInput(input.pinCode, 10),
      googleMapsLocation: sanitizeInput(input.googleMapsLocation, 250),
      siteContactPerson: sanitizeInput(input.siteContactPerson, 100),
      siteManagerName: sanitizeInput(input.siteManagerName, 100),
      managerMobile: sanitizeInput(input.managerMobile, 20),
      managerEmail: sanitizeInput(input.managerEmail.toLowerCase(), 160),
      startDate: input.startDate,
      contractEndDate: input.contractEndDate,
      siteStatus: input.siteStatus,
      notes: sanitizeInput(input.notes, 500),
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Updated',
        module: 'Site',
        recordId: siteId,
        branchId: input.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function getSiteByIdForAttendance(
  siteId: string,
  isPreviewSession: boolean
): Promise<SiteRecord | null> {
  if (!siteId.trim()) return null;
  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    return store.sites.find((s) => s.siteId === siteId && !s.isArchived) ?? null;
  }
  const path = `sites/${siteId}`;
  try {
    const snap = await getDoc(doc(firestoreDb!, 'sites', siteId));
    if (!snap.exists()) return null;
    const record = snap.data() as SiteRecord;
    return record.isArchived ? null : record;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function updateSiteAttendanceSettings(
  caller: RexonUser,
  isPreviewSession: boolean,
  config: SiteGeoQrConfigInput
): Promise<SiteRecord> {
  if (
    caller.role !== 'admin' &&
    !(
      caller.role === 'hr' &&
      (hasUserPermission(caller, 'attendance.gps_settings') ||
        hasUserPermission(caller, 'site.edit'))
    )
  ) {
    throw new Error(
      'Configuring site GPS geofence & QR settings requires Admin access or attendance.gps_settings permission.'
    );
  }

  const clampedRadius = Math.min(5000, Math.max(20, Math.round(config.allowedRadiusMeters || 150)));
  const clampedAccuracy = Math.min(
    1000,
    Math.max(10, Math.round(config.gpsAccuracyThresholdMeters || 100))
  );

  if (config.latitude !== null || config.longitude !== null) {
    if (
      config.latitude === null ||
      config.longitude === null ||
      !Number.isFinite(config.latitude) ||
      !Number.isFinite(config.longitude) ||
      config.latitude < -90 ||
      config.latitude > 90 ||
      config.longitude < -180 ||
      config.longitude > 180
    ) {
      throw new Error(
        'Enter valid Latitude (-90 to 90) and Longitude (-180 to 180) coordinates.'
      );
    }
  } else if (config.isGpsMandatory) {
    throw new Error(
      'Site Latitude and Longitude are required when Mandatory GPS Geofence is enabled.'
    );
  }

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.sites.find((s) => s.siteId === config.siteId);
    if (!target) {
      throw new Error(`Site ${config.siteId} not found.`);
    }
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.branchId)) {
      throw new Error('Unauthorized branch scope for site GPS/QR configuration.');
    }

    const updatedSite: SiteRecord = {
      ...target,
      latitude: config.latitude,
      longitude: config.longitude,
      googleMapsLocation:
        config.latitude !== null && config.longitude !== null
          ? `${config.latitude}, ${config.longitude}`
          : target.googleMapsLocation,
      allowedRadiusMeters: clampedRadius,
      gpsAccuracyThresholdMeters: clampedAccuracy,
      isGpsMandatory: config.isGpsMandatory,
      isQrEnabled: config.isQrEnabled,
      updatedAt: nowIso,
      history: [
        makeHistoryEntry(
          caller,
          'SITE_GEOFENCE_UPDATED',
          `Configured GPS radius ${clampedRadius}m, accuracy <=${clampedAccuracy}m, GPS mandatory: ${config.isGpsMandatory}, QR enabled: ${config.isQrEnabled}`
        ),
        ...target.history,
      ],
    };

    store.sites = store.sites.map((s) => (s.siteId === config.siteId ? updatedSite : s));
    appendLocalAudit(store, caller, {
      action: 'Site Geofence & QR Updated',
      module: 'Attendance',
      recordId: config.siteId,
      branchId: target.branchId,
      summary: `Updated attendance geofence on ${target.siteName} (${config.siteId}): radius ${clampedRadius}m, accuracy <=${clampedAccuracy}m, QR=${config.isQrEnabled}.`,
    });
    writeLocalStore(store);
    return updatedSite;
  }

  const path = `sites/${config.siteId}`;
  try {
    const siteRef = doc(firestoreDb!, 'sites', config.siteId);
    const snap = await getDoc(siteRef);
    if (!snap.exists()) {
      throw new Error(`Site ${config.siteId} not found.`);
    }
    const target = snap.data() as SiteRecord;
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.branchId)) {
      throw new Error('Unauthorized branch scope for site GPS/QR configuration.');
    }

    const batch = writeBatch(firestoreDb!);
    const nextMapsLoc =
      config.latitude !== null && config.longitude !== null
        ? `${config.latitude}, ${config.longitude}`
        : target.googleMapsLocation;

    batch.update(siteRef, {
      latitude: config.latitude,
      longitude: config.longitude,
      googleMapsLocation: nextMapsLoc,
      allowedRadiusMeters: clampedRadius,
      gpsAccuracyThresholdMeters: clampedAccuracy,
      isGpsMandatory: config.isGpsMandatory,
      isQrEnabled: config.isQrEnabled,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });

    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Geofence & QR Updated',
        module: 'Attendance',
        recordId: config.siteId,
        branchId: target.branchId,
        summary: `Updated attendance geofence on ${target.siteName} (${config.siteId}): radius ${clampedRadius}m, accuracy <=${clampedAccuracy}m, QR=${config.isQrEnabled}.`,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return {
      ...target,
      latitude: config.latitude,
      longitude: config.longitude,
      googleMapsLocation: nextMapsLoc,
      allowedRadiusMeters: clampedRadius,
      gpsAccuracyThresholdMeters: clampedAccuracy,
      isGpsMandatory: config.isGpsMandatory,
      isQrEnabled: config.isQrEnabled,
      updatedAt: nowIso,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateSiteStatusOnly(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId: string,
  nextStatus: SiteStatus
): Promise<void> {
  if (!hasUserPermission(caller, 'site.edit')) {
    throw new Error('Unauthorized to update Site status.');
  }
  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.sites.find((s) => s.siteId === siteId);
    store.sites = store.sites.map((s) =>
      s.siteId === siteId
        ? {
            ...s,
            siteStatus: nextStatus,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(caller, 'SITE_STATUS_CHANGED', `Status set to ${nextStatus}`),
              ...s.history,
            ],
          }
        : s
    );
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'Site',
      recordId: siteId,
      branchId: target?.branchId || caller.branchId,
      summary: `Changed Site ${siteId} status to ${nextStatus}.`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `sites/${siteId}`;
  try {
    await updateDoc(doc(firestoreDb!, 'sites', siteId), {
      siteStatus: nextStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function archiveSiteRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId: string
): Promise<void> {
  if (!hasUserPermission(caller, 'site.delete')) {
    throw new Error(
      'Direct Site deletion/archival requires Admin privileges or site.delete permission. Submit an Admin Approval request instead.'
    );
  }

  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.sites.find((s) => s.siteId === siteId);
    if (!target) throw new Error(`Site ${siteId} not found.`);
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.branchId)) {
      throw new Error('Unauthorized branch scope for Site archival.');
    }

    store.sites = store.sites.map((s) =>
      s.siteId === siteId
        ? {
            ...s,
            siteStatus: 'Inactive',
            isArchived: true,
            archivedAt: nowIso,
            archivedBy: `${caller.fullName} (${caller.uid})`,
            updatedAt: nowIso,
            history: [
              makeHistoryEntry(
                caller,
                'SITE_ARCHIVED',
                'Archived site record; historical deployment & billing references preserved'
              ),
              ...s.history,
            ],
          }
        : s
    );
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'Site',
      recordId: siteId,
      branchId: target.branchId,
      summary: `Archived Site ${siteId} (${target.siteName}); historical records retained.`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `sites/${siteId}`;
  try {
    const siteRef = doc(firestoreDb!, 'sites', siteId);
    const snap = await getDoc(siteRef);
    const target = snap.exists() ? (snap.data() as SiteRecord) : null;
    const branchId = target?.branchId || caller.branchId;

    const batch = writeBatch(firestoreDb!);
    batch.update(siteRef, {
      siteStatus: 'Inactive',
      isArchived: true,
      archivedAt: nowIso,
      archivedBy: caller.uid,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Updated',
        module: 'Site',
        recordId: siteId,
        branchId,
        summary: `Archived Site ${siteId} (${target?.siteName ?? siteId}); historical records retained.`,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 5. SERVICE MANAGEMENT (`services` COLLECTION — STORED IN FIRESTORE)
// ============================================================================
let liveCatalogSeedPromise: Promise<void> | null = null;

async function ensureLiveServicesAndDesignationsBootstrapped(caller: RexonUser): Promise<void> {
  if (!firestoreDb || caller.role !== 'admin') return;
  if (liveCatalogSeedPromise) {
    await liveCatalogSeedPromise;
    return;
  }

  liveCatalogSeedPromise = (async () => {
    const srvSnap = await getDocs(collection(firestoreDb, 'services'));
    if (!srvSnap.empty) return;

    const { services, designations } = buildInitialServicesAndDesignations();
    const batch = writeBatch(firestoreDb);
    for (const s of services) {
      batch.set(doc(firestoreDb, 'services', s.serviceId), {
        ...s,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    for (const d of designations) {
      batch.set(doc(firestoreDb, 'designations', d.designationId), {
        ...d,
        serverUpdatedAt: serverTimestamp(),
      });
    }
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Service Created',
        module: 'Service',
        recordId: 'SRV-CATALOG-INIT',
        branchId: caller.branchId || 'ALL',
        summary:
          'Initialized 23 REXON Services and Designations across Security, Housekeeping, and Manpower in Firestore.',
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  })();

  try {
    await liveCatalogSeedPromise;
  } finally {
    liveCatalogSeedPromise = null;
  }
}

export async function listServices(
  caller: RexonUser,
  isPreviewSession: boolean,
  options?: { activeOnly?: boolean }
): Promise<ServiceRecord[]> {
  if (
    caller.role !== 'admin' &&
    caller.role !== 'field_officer' &&
    !hasUserPermission(caller, 'service.view') &&
    !hasUserPermission(caller, 'site.view') &&
    !hasUserPermission(caller, 'site.edit') &&
    !hasUserPermission(caller, 'employee.view') &&
    !hasUserPermission(caller, 'assignment.view')
  ) {
    return [];
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const rows = options?.activeOnly
      ? store.services.filter((s) => s.status === 'Active')
      : store.services;
    return [...rows].sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  }

  const path = 'services';
  try {
    await ensureLiveServicesAndDesignationsBootstrapped(caller);
    const snap = await getDocs(collection(firestoreDb!, path));
    const all = snap.docs.map((d) => d.data() as ServiceRecord);
    const rows = options?.activeOnly ? all.filter((s) => s.status === 'Active') : all;
    return rows.sort((a, b) => (a.serviceId || '').localeCompare(b.serviceId || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createServiceRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: ServiceFormInput
): Promise<ServiceRecord> {
  if (!hasUserPermission(caller, 'service.manage')) {
    throw new Error('Only Administrators (or HR with service.manage) can create Services.');
  }

  const existing = await listServices(caller, isPreviewSession);
  const validation = validateServiceForm(input, existing);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Service validation failed.');
  }

  const serviceId = generateNextId(
    'SRV',
    existing.map((s) => s.serviceId)
  );
  const nowIso = new Date().toISOString();

  const record: ServiceRecord = {
    serviceId,
    serviceName: sanitizeInput(input.serviceName, 100),
    serviceCategory: input.serviceCategory,
    serviceCode: normalizeCode(input.serviceCode),
    description: sanitizeInput(input.description, 300),
    status: input.status,
    createdBy: `${caller.fullName} (${caller.role})`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const summary = `Created Service ${serviceId} (${record.serviceName}) under category ${record.serviceCategory}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.services.push(record);
    appendLocalAudit(store, caller, {
      action: 'Service Created',
      module: 'Service',
      recordId: serviceId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `services/${serviceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'services', serviceId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Service Created',
        module: 'Service',
        recordId: serviceId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateServiceRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  serviceId: string,
  input: ServiceFormInput
): Promise<void> {
  if (!hasUserPermission(caller, 'service.manage')) {
    throw new Error('Only Administrators (or HR with service.manage) can edit Services.');
  }

  const existingServices = await listServices(caller, isPreviewSession);
  const validation = validateServiceForm(input, existingServices, serviceId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Service validation failed.');
  }

  const nowIso = new Date().toISOString();
  const cleanName = sanitizeInput(input.serviceName, 100);
  const summary = `Updated Service ${serviceId} (${cleanName} · ${input.serviceCategory}) · Status: ${input.status}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.services = store.services.map((s) =>
      s.serviceId === serviceId
        ? {
            ...s,
            serviceName: cleanName,
            serviceCategory: input.serviceCategory,
            serviceCode: normalizeCode(input.serviceCode),
            description: sanitizeInput(input.description, 300),
            status: input.status,
            updatedAt: nowIso,
          }
        : s
    );
    store.designations = store.designations.map((d) =>
      d.relatedServiceId === serviceId
        ? { ...d, relatedServiceName: cleanName, serviceCategory: input.serviceCategory }
        : d
    );
    store.siteServices = store.siteServices.map((cfg) =>
      cfg.serviceId === serviceId
        ? { ...cfg, serviceName: cleanName, serviceCategory: input.serviceCategory }
        : cfg
    );
    appendLocalAudit(store, caller, {
      action: 'Service Updated',
      module: 'Service',
      recordId: serviceId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `services/${serviceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'services', serviceId), {
      serviceName: cleanName,
      serviceCategory: input.serviceCategory,
      serviceCode: normalizeCode(input.serviceCode),
      description: sanitizeInput(input.description, 300),
      status: input.status,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Service Updated',
        module: 'Service',
        recordId: serviceId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleServiceStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  serviceId: string,
  nextStatus: MasterActiveStatus
): Promise<void> {
  if (!hasUserPermission(caller, 'service.manage')) {
    throw new Error('Only Administrators (or HR with service.manage) can activate or deactivate Services.');
  }

  const nowIso = new Date().toISOString();
  const summary = `Changed Service ${serviceId} status to ${nextStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.services = store.services.map((s) =>
      s.serviceId === serviceId ? { ...s, status: nextStatus, updatedAt: nowIso } : s
    );
    appendLocalAudit(store, caller, {
      action: 'Service Updated',
      module: 'Service',
      recordId: serviceId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `services/${serviceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'services', serviceId), {
      status: nextStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Service Updated',
        module: 'Service',
        recordId: serviceId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 6. DESIGNATION MANAGEMENT (`designations` COLLECTION — DYNAMICALLY EXTENSIBLE)
// ============================================================================
export async function listDesignations(
  caller: RexonUser,
  isPreviewSession: boolean,
  options?: { activeOnly?: boolean }
): Promise<DesignationRecord[]> {
  if (
    caller.role !== 'admin' &&
    caller.role !== 'field_officer' &&
    !hasUserPermission(caller, 'designation.view') &&
    !hasUserPermission(caller, 'site.view') &&
    !hasUserPermission(caller, 'site.edit') &&
    !hasUserPermission(caller, 'employee.view') &&
    !hasUserPermission(caller, 'assignment.view')
  ) {
    return [];
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const rows = options?.activeOnly
      ? store.designations.filter((d) => d.status === 'Active')
      : store.designations;
    return [...rows].sort((a, b) => a.designationId.localeCompare(b.designationId));
  }

  const path = 'designations';
  try {
    await ensureLiveServicesAndDesignationsBootstrapped(caller);
    const snap = await getDocs(collection(firestoreDb!, path));
    const all = snap.docs.map((d) => d.data() as DesignationRecord);
    const rows = options?.activeOnly ? all.filter((d) => d.status === 'Active') : all;
    return rows.sort((a, b) => (a.designationId || '').localeCompare(b.designationId || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createDesignationRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: DesignationFormInput
): Promise<DesignationRecord> {
  if (!hasUserPermission(caller, 'designation.manage')) {
    throw new Error('Only Administrators (or HR with designation.manage) can create Designations.');
  }

  const existing = await listDesignations(caller, isPreviewSession);
  const validation = validateDesignationForm(input, existing);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Designation validation failed.');
  }

  const designationId = generateNextId(
    'DSG',
    existing.map((d) => d.designationId)
  );
  const nowIso = new Date().toISOString();

  const record: DesignationRecord = {
    designationId,
    designationName: sanitizeInput(input.designationName, 100),
    serviceCategory: input.serviceCategory,
    relatedServiceId: input.relatedServiceId,
    relatedServiceName: sanitizeInput(input.relatedServiceName, 100),
    description: sanitizeInput(input.description, 300),
    requiredSkills: sanitizeInput(input.requiredSkills, 250),
    qualification: sanitizeInput(input.qualification, 160),
    trainingRequirements: sanitizeInput(input.trainingRequirements, 200),
    licenseRequirements: sanitizeInput(input.licenseRequirements, 200),
    status: input.status,
    createdBy: `${caller.fullName} (${caller.role})`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const summary = `Created Designation ${designationId} (${record.designationName}) linked to ${record.relatedServiceName} (${record.serviceCategory}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.designations.push(record);
    appendLocalAudit(store, caller, {
      action: 'Designation Created',
      module: 'Designation',
      recordId: designationId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `designations/${designationId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'designations', designationId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Designation Created',
        module: 'Designation',
        recordId: designationId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateDesignationRecord(
  caller: RexonUser,
  isPreviewSession: boolean,
  designationId: string,
  input: DesignationFormInput
): Promise<void> {
  if (!hasUserPermission(caller, 'designation.manage')) {
    throw new Error('Only Administrators (or HR with designation.manage) can edit Designations.');
  }

  const existingDesignations = await listDesignations(caller, isPreviewSession);
  const validation = validateDesignationForm(input, existingDesignations, designationId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Designation validation failed.');
  }

  const nowIso = new Date().toISOString();
  const cleanName = sanitizeInput(input.designationName, 100);
  const summary = `Updated Designation ${designationId} (${cleanName}) · Status: ${input.status}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.designations = store.designations.map((d) =>
      d.designationId === designationId
        ? {
            ...d,
            designationName: cleanName,
            serviceCategory: input.serviceCategory,
            relatedServiceId: input.relatedServiceId,
            relatedServiceName: sanitizeInput(input.relatedServiceName, 100),
            description: sanitizeInput(input.description, 300),
            requiredSkills: sanitizeInput(input.requiredSkills, 250),
            qualification: sanitizeInput(input.qualification, 160),
            trainingRequirements: sanitizeInput(input.trainingRequirements, 200),
            licenseRequirements: sanitizeInput(input.licenseRequirements, 200),
            status: input.status,
            updatedAt: nowIso,
          }
        : d
    );
    store.siteServices = store.siteServices.map((cfg) =>
      cfg.designationId === designationId ? { ...cfg, designationName: cleanName } : cfg
    );
    appendLocalAudit(store, caller, {
      action: 'Designation Updated',
      module: 'Designation',
      recordId: designationId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `designations/${designationId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'designations', designationId), {
      designationName: cleanName,
      serviceCategory: input.serviceCategory,
      relatedServiceId: input.relatedServiceId,
      relatedServiceName: sanitizeInput(input.relatedServiceName, 100),
      description: sanitizeInput(input.description, 300),
      requiredSkills: sanitizeInput(input.requiredSkills, 250),
      qualification: sanitizeInput(input.qualification, 160),
      trainingRequirements: sanitizeInput(input.trainingRequirements, 200),
      licenseRequirements: sanitizeInput(input.licenseRequirements, 200),
      status: input.status,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Designation Updated',
        module: 'Designation',
        recordId: designationId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function toggleDesignationStatus(
  caller: RexonUser,
  isPreviewSession: boolean,
  designationId: string,
  nextStatus: MasterActiveStatus
): Promise<void> {
  if (!hasUserPermission(caller, 'designation.manage')) {
    throw new Error('Only Administrators (or HR with designation.manage) can activate or deactivate Designations.');
  }

  const nowIso = new Date().toISOString();
  const summary = `Changed Designation ${designationId} status to ${nextStatus}.`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.designations = store.designations.map((d) =>
      d.designationId === designationId ? { ...d, status: nextStatus, updatedAt: nowIso } : d
    );
    appendLocalAudit(store, caller, {
      action: 'Designation Updated',
      module: 'Designation',
      recordId: designationId,
      branchId: caller.branchId || 'ALL',
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `designations/${designationId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'designations', designationId), {
      status: nextStatus,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Designation Updated',
        module: 'Designation',
        recordId: designationId,
        branchId: caller.branchId || 'ALL',
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 7. SITE SERVICE CONFIGURATION (`siteServices` COLLECTION)
//    Vacant = Math.max(0, Required - Deployed) — Never negative!
// ============================================================================
export function computeSiteManpowerSummary(
  configs: SiteServiceConfigRecord[]
): SiteManpowerSummary {
  const byCategory: Record<ServiceCategory, CategoryManpowerRollup> = {
    Security: {
      category: 'Security',
      designationLines: 0,
      requiredCount: 0,
      deployedCount: 0,
      vacantCount: 0,
    },
    Housekeeping: {
      category: 'Housekeeping',
      designationLines: 0,
      requiredCount: 0,
      deployedCount: 0,
      vacantCount: 0,
    },
    Manpower: {
      category: 'Manpower',
      designationLines: 0,
      requiredCount: 0,
      deployedCount: 0,
      vacantCount: 0,
    },
  };

  let totalLines = 0;
  let totalRequired = 0;
  let totalDeployed = 0;
  let totalVacant = 0;

  for (const cfg of configs) {
    if (cfg.status !== 'Active') continue;
    const req = Math.max(0, Math.floor(cfg.requiredCount));
    const dep = Math.min(req, Math.max(0, Math.floor(cfg.deployedCount)));
    const vac = computeNonNegativeVacancy(req, dep);

    if ((SERVICE_CATEGORIES as readonly string[]).includes(cfg.serviceCategory)) {
      const bucket = byCategory[cfg.serviceCategory];
      bucket.designationLines += 1;
      bucket.requiredCount += req;
      bucket.deployedCount += dep;
      bucket.vacantCount += vac;
    }

    totalLines += 1;
    totalRequired += req;
    totalDeployed += dep;
    totalVacant += vac;
  }

  return {
    totalLines,
    totalRequired,
    totalDeployed,
    totalVacant,
    byCategory,
  };
}

export async function listSiteServiceConfigs(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteId?: string
): Promise<SiteServiceConfigRecord[]> {
  if (caller.role === 'hr' && !hasUserPermission(caller, 'site.view')) {
    return [];
  }
  const authorizedBranches = getAuthorizedBranchIds(caller);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    return store.siteServices
      .filter((cfg) => {
        if (siteId && cfg.siteId !== siteId) return false;
        if (caller.role === 'admin') return true;
        if (caller.role === 'hr') return authorizedBranches.includes(cfg.branchId);
        return caller.assignedSiteIds.includes(cfg.siteId);
      })
      .map((cfg) => ({
        ...cfg,
        vacantCount: computeNonNegativeVacancy(cfg.requiredCount, cfg.deployedCount),
      }))
      .sort((a, b) => a.siteServiceId.localeCompare(b.siteServiceId));
  }

  const path = 'siteServices';
  try {
    let q;
    if (caller.role === 'admin') {
      q = siteId
        ? query(collection(firestoreDb!, path), where('siteId', '==', siteId))
        : query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else {
      if (!caller.assignedSiteIds || caller.assignedSiteIds.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('siteId', 'in', caller.assignedSiteIds.slice(0, 10))
      );
    }
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data() as SiteServiceConfigRecord;
        return {
          ...data,
          vacantCount: computeNonNegativeVacancy(data.requiredCount, data.deployedCount),
        };
      })
      .filter((cfg) => (!siteId ? true : cfg.siteId === siteId))
      .sort((a, b) => (a.siteServiceId || '').localeCompare(b.siteServiceId || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createSiteServiceConfig(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: SiteServiceConfigFormInput
): Promise<SiteServiceConfigRecord> {
  if (!hasUserPermission(caller, 'site.edit') && !hasUserPermission(caller, 'site.create')) {
    throw new Error('Configuring Site Services requires site.edit or site.create permission.');
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('You can only configure Site Services within your assigned branch(es).');
  }
  if (input.deployedCount > input.requiredCount) {
    throw new Error('Deployed Count cannot exceed Required Count (negative vacancy is prohibited).');
  }

  const existing = await listSiteServiceConfigs(caller, isPreviewSession);
  const validation = validateSiteServiceConfigForm(input, existing);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Site Service configuration validation failed.');
  }

  const siteServiceId = generateNextId(
    'SSC',
    existing.map((c) => c.siteServiceId)
  );
  const nowIso = new Date().toISOString();
  const vacantCount = computeNonNegativeVacancy(input.requiredCount, input.deployedCount);

  const record: SiteServiceConfigRecord = {
    siteServiceId,
    siteId: input.siteId,
    siteName: sanitizeInput(input.siteName, 140),
    clientId: input.clientId,
    branchId: input.branchId,
    serviceCategory: input.serviceCategory,
    serviceId: input.serviceId,
    serviceName: sanitizeInput(input.serviceName, 100),
    designationId: input.designationId,
    designationName: sanitizeInput(input.designationName, 100),
    requiredCount: Math.max(1, Math.floor(input.requiredCount)),
    deployedCount: Math.max(0, Math.floor(input.deployedCount)),
    vacantCount,
    shiftType: sanitizeInput(input.shiftType, 60),
    workingHours: sanitizeInput(input.workingHours, 40),
    weeklyOff: sanitizeInput(input.weeklyOff, 60),
    serviceStartDate: input.serviceStartDate,
    serviceEndDate: input.serviceEndDate,
    notes: sanitizeInput(input.notes, 300),
    status: input.status,
    createdBy: `${caller.fullName} (${caller.role})`,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const summary = `Configured ${record.serviceCategory} — ${record.designationName} on Site ${record.siteId} (Required: ${record.requiredCount}, Deployed: ${record.deployedCount}, Vacant: ${record.vacantCount}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.siteServices.push(record);
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'SiteService',
      recordId: record.siteId,
      branchId: record.branchId,
      summary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `siteServices/${siteServiceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'siteServices', siteServiceId), {
      ...record,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Updated',
        module: 'SiteService',
        recordId: record.siteId,
        branchId: record.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSiteServiceConfig(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteServiceId: string,
  input: SiteServiceConfigFormInput
): Promise<void> {
  if (!hasUserPermission(caller, 'site.edit')) {
    throw new Error('Updating Site Services requires site.edit permission.');
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('Unauthorized branch scope for Site Service configuration.');
  }
  if (input.deployedCount > input.requiredCount) {
    throw new Error('Deployed Count cannot exceed Required Count (negative vacancy is prohibited).');
  }

  const existingConfigs = await listSiteServiceConfigs(caller, isPreviewSession);
  const validation = validateSiteServiceConfigForm(input, existingConfigs, siteServiceId);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Site Service configuration validation failed.');
  }

  const nowIso = new Date().toISOString();
  const requiredCount = Math.max(1, Math.floor(input.requiredCount));
  const deployedCount = Math.max(0, Math.floor(input.deployedCount));
  const vacantCount = computeNonNegativeVacancy(requiredCount, deployedCount);

  const summary = `Updated ${input.serviceCategory} — ${input.designationName} on Site ${input.siteId} (Required: ${requiredCount}, Deployed: ${deployedCount}, Vacant: ${vacantCount}).`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.siteServices = store.siteServices.map((cfg) =>
      cfg.siteServiceId === siteServiceId
        ? {
            ...cfg,
            serviceCategory: input.serviceCategory,
            serviceId: input.serviceId,
            serviceName: sanitizeInput(input.serviceName, 100),
            designationId: input.designationId,
            designationName: sanitizeInput(input.designationName, 100),
            requiredCount,
            deployedCount,
            vacantCount,
            shiftType: sanitizeInput(input.shiftType, 60),
            workingHours: sanitizeInput(input.workingHours, 40),
            weeklyOff: sanitizeInput(input.weeklyOff, 60),
            serviceStartDate: input.serviceStartDate,
            serviceEndDate: input.serviceEndDate,
            notes: sanitizeInput(input.notes, 300),
            status: input.status,
            updatedAt: nowIso,
          }
        : cfg
    );
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'SiteService',
      recordId: input.siteId,
      branchId: input.branchId,
      summary,
    });
    writeLocalStore(store);
    return;
  }

  const path = `siteServices/${siteServiceId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.update(doc(firestoreDb!, 'siteServices', siteServiceId), {
      serviceCategory: input.serviceCategory,
      serviceId: input.serviceId,
      serviceName: sanitizeInput(input.serviceName, 100),
      designationId: input.designationId,
      designationName: sanitizeInput(input.designationName, 100),
      requiredCount,
      deployedCount,
      vacantCount,
      shiftType: sanitizeInput(input.shiftType, 60),
      workingHours: sanitizeInput(input.workingHours, 40),
      weeklyOff: sanitizeInput(input.weeklyOff, 60),
      serviceStartDate: input.serviceStartDate,
      serviceEndDate: input.serviceEndDate,
      notes: sanitizeInput(input.notes, 300),
      status: input.status,
      updatedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Site Updated',
        module: 'SiteService',
        recordId: input.siteId,
        branchId: input.branchId,
        summary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeSiteServiceConfig(
  caller: RexonUser,
  isPreviewSession: boolean,
  siteServiceId: string
): Promise<void> {
  if (!hasUserPermission(caller, 'site.edit')) {
    throw new Error('Removing a Site Service line requires site.edit permission.');
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.siteServices.find((c) => c.siteServiceId === siteServiceId);
    if (!target) return;
    if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(target.branchId)) {
      throw new Error('Unauthorized branch scope.');
    }
    store.siteServices = store.siteServices.filter((c) => c.siteServiceId !== siteServiceId);
    appendLocalAudit(store, caller, {
      action: 'Site Updated',
      module: 'SiteService',
      recordId: target.siteId,
      branchId: target.branchId,
      summary: `Removed ${target.serviceCategory} — ${target.designationName} configuration from Site ${target.siteId}.`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `siteServices/${siteServiceId}`;
  try {
    const cfgRef = doc(firestoreDb!, 'siteServices', siteServiceId);
    const snap = await getDoc(cfgRef);
    const target = snap.exists() ? (snap.data() as SiteServiceConfigRecord) : null;
    await deleteDoc(cfgRef);
    if (target) {
      const logId = makeRuntimeLogId();
      await setDoc(doc(firestoreDb!, 'auditLogs', logId), {
        ...buildAuditLogObject(caller, {
          logId,
          action: 'Site Updated',
          module: 'SiteService',
          recordId: target.siteId,
          branchId: target.branchId,
          summary: `Removed ${target.serviceCategory} — ${target.designationName} configuration from Site ${target.siteId}.`,
        }),
        createdAt: serverTimestamp(),
      });
    }
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// 8. APPROVAL WORKFLOW (`approvals` COLLECTION — TRANSACTIONAL DECISIONS)
// ============================================================================
export async function listApprovalRequests(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<ApprovalRequestRecord[]> {
  if (caller.role !== 'admin' && caller.role !== 'hr' && caller.role !== 'field_officer') {
    return [];
  }
  const authorizedBranches = getAuthorizedBranchIds(caller);

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const rows =
      caller.role === 'admin'
        ? store.approvals
        : caller.role === 'hr'
          ? store.approvals.filter(
              (a) =>
                a.requestedByUid === caller.uid || authorizedBranches.includes(a.branchId)
            )
          : store.approvals.filter((a) => a.requestedByUid === caller.uid);
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const path = 'approvals';
  try {
    let q;
    if (caller.role === 'admin') {
      q = query(collection(firestoreDb!, path));
    } else if (caller.role === 'hr') {
      if (authorizedBranches.length === 0) return [];
      q = query(
        collection(firestoreDb!, path),
        where('branchId', 'in', authorizedBranches.slice(0, 10))
      );
    } else {
      q = query(collection(firestoreDb!, path), where('requestedByUid', '==', caller.uid));
    }
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as ApprovalRequestRecord)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function submitApprovalRequest(
  caller: RexonUser,
  isPreviewSession: boolean,
  input: SubmitApprovalInput
): Promise<ApprovalRequestRecord> {
  if (caller.role !== 'hr' && caller.role !== 'admin' && caller.role !== 'field_officer') {
    throw new Error('Only Admin, HR, or Field Officer users can submit workflow approval requests.');
  }
  if (caller.role === 'hr' && !getAuthorizedBranchIds(caller).includes(input.branchId)) {
    throw new Error('You can only submit approval requests for your assigned branch(es).');
  }
  if (caller.role === 'field_officer' && input.module !== 'Assignment') {
    throw new Error('Field Officers can only submit Assignment replacement, transfer, or shortage requests.');
  }

  const existing = await listApprovalRequests(caller, isPreviewSession);
  const approvalId = generateNextId(
    'APR',
    existing.map((a) => a.approvalId)
  );
  const nowIso = new Date().toISOString();

  const record: ApprovalRequestRecord = {
    approvalId,
    requestType: input.requestType,
    module: input.module,
    targetRecordId: sanitizeInput(input.targetRecordId, 64),
    targetRecordName: sanitizeInput(input.targetRecordName, 140),
    branchId: sanitizeInput(input.branchId, 64),
    requestedByUid: caller.uid,
    requestedByName: caller.fullName,
    requestedByRole: caller.role,
    summary: sanitizeInput(input.summary, 160),
    reason: sanitizeInput(input.reason, 400),
    ...(input.proposedPayload ? { proposedPayload: input.proposedPayload } : {}),
    status: 'Pending',
    reviewedByUid: null,
    reviewedByName: null,
    reviewRemarks: '',
    createdAt: nowIso,
    updatedAt: nowIso,
    decidedAt: null,
  };

  const auditSummary = `Submitted approval request ${approvalId} (${record.requestType}) for ${record.targetRecordId}: ${record.summary}`;

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    store.approvals.unshift(record);
    appendLocalAudit(store, caller, {
      action: 'Approval Submitted',
      module: 'Approvals',
      recordId: approvalId,
      branchId: record.branchId,
      summary: auditSummary,
    });
    writeLocalStore(store);
    return record;
  }

  const path = `approvals/${approvalId}`;
  try {
    const batch = writeBatch(firestoreDb!);
    batch.set(doc(firestoreDb!, 'approvals', approvalId), {
      ...record,
      serverCreatedAt: serverTimestamp(),
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Approval Submitted',
        module: 'Approvals',
        recordId: approvalId,
        branchId: record.branchId,
        summary: auditSummary,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
    return record;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function decideApprovalRequest(
  caller: RexonUser,
  isPreviewSession: boolean,
  approvalId: string,
  decision: 'Approved' | 'Rejected',
  reviewRemarks: string
): Promise<void> {
  if (caller.role !== 'admin' && caller.role !== 'hr') {
    throw new Error('Only Administrators or authorized HR can review approval requests.');
  }

  const nowIso = new Date().toISOString();
  const cleanRemarks = sanitizeInput(
    reviewRemarks || (decision === 'Approved' ? 'Approved by Administrator.' : 'Rejected by Administrator.'),
    300
  );

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.approvals.find((a) => a.approvalId === approvalId);
    if (!target) throw new Error(`Approval request ${approvalId} not found.`);
    if (target.status !== 'Pending') {
      throw new Error(`Approval request ${approvalId} is already finalized (${target.status}).`);
    }
    if (caller.role === 'hr') {
      const canHrReviewFo =
        target.module === 'Assignment' &&
        target.requestedByRole === 'field_officer' &&
        getAuthorizedBranchIds(caller).includes(target.branchId) &&
        (hasUserPermission(caller, 'assignment.manage') ||
          hasUserPermission(caller, 'assignment.edit'));
      if (!canHrReviewFo) {
        throw new Error(
          'HR users can review Field Officer assignment actions within their branch; elevated HR/Master approvals require an Administrator.'
        );
      }
    }

    store.approvals = store.approvals.map((a) =>
      a.approvalId === approvalId
        ? {
            ...a,
            status: decision,
            reviewedByUid: caller.uid,
            reviewedByName: caller.fullName,
            reviewRemarks: cleanRemarks,
            updatedAt: nowIso,
            decidedAt: nowIso,
          }
        : a
    );

    if (decision === 'Approved') {
      if (target.requestType === 'Site Deletion') {
        store.sites = store.sites.map((s) =>
          s.siteId === target.targetRecordId
            ? {
                ...s,
                siteStatus: 'Inactive',
                isArchived: true,
                archivedAt: nowIso,
                archivedBy: `${caller.fullName} (via ${approvalId})`,
                updatedAt: nowIso,
                history: [
                  makeHistoryEntry(
                    caller,
                    'SITE_ARCHIVED_BY_APPROVAL',
                    `Archived following Admin approval ${approvalId}`
                  ),
                  ...s.history,
                ],
              }
            : s
        );
      } else if (target.requestType === 'Client Deletion') {
        store.clients = store.clients.map((c) =>
          c.clientId === target.targetRecordId
            ? {
                ...c,
                clientStatus: 'Inactive',
                isArchived: true,
                updatedAt: nowIso,
                history: [
                  makeHistoryEntry(
                    caller,
                    'CLIENT_ARCHIVED_BY_APPROVAL',
                    `Archived following Admin approval ${approvalId}`
                  ),
                  ...c.history,
                ],
              }
            : c
        );
      } else if (target.requestType === 'Employee Deletion') {
        try {
          const empRaw = localStorage.getItem('rexon_phase3_employees_v1');
          if (empRaw) {
            const empStore = JSON.parse(empRaw) as {
              employees?: Record<string, unknown>[];
              employeeHistory?: Record<string, unknown>[];
            };
            if (Array.isArray(empStore.employees)) {
              empStore.employees = empStore.employees.map((emp) =>
                emp.employeeId === target.targetRecordId
                  ? {
                      ...emp,
                      employeeStatus: 'Inactive',
                      isActive: false,
                      isDeleted: true,
                      deletedAt: nowIso,
                      deletedBy: `${caller.fullName} (via ${approvalId})`,
                      updatedAt: nowIso,
                      updatedBy: `${caller.fullName} (${caller.role})`,
                    }
                  : emp
              );
            }
            if (Array.isArray(empStore.employeeHistory)) {
              empStore.employeeHistory.unshift({
                historyId: `EHS-${Date.now()}`,
                employeeId: target.targetRecordId,
                linkedUid: '',
                branchId: target.branchId,
                category: 'Activity',
                action: 'Soft-Deleted via Admin Approval',
                summary: `Archived following Admin approval ${approvalId}. Remarks: ${cleanRemarks}`,
                actorUid: caller.uid,
                actorName: caller.fullName,
                actorRole: caller.role,
                timestamp: nowIso,
              });
            }
            localStorage.setItem('rexon_phase3_employees_v1', JSON.stringify(empStore));
          }
        } catch {
          // Ignore local storage parse errors
        }
      }
    }

    appendLocalAudit(store, caller, {
      action: decision === 'Approved' ? 'Approval Approved' : 'Approval Rejected',
      module: 'Approvals',
      recordId: approvalId,
      branchId: target.branchId,
      summary: `${decision} request ${approvalId} (${target.requestType} on ${target.targetRecordId}). Remarks: ${cleanRemarks}`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `approvals/${approvalId}`;
  try {
    await runTransaction(firestoreDb!, async (tx) => {
      const aprRef = doc(firestoreDb!, 'approvals', approvalId);
      const aprSnap = await tx.get(aprRef);
      if (!aprSnap.exists()) {
        throw new Error(`Approval request ${approvalId} does not exist.`);
      }
      const target = aprSnap.data() as ApprovalRequestRecord;
      if (target.status !== 'Pending') {
        throw new Error(`Approval request ${approvalId} is already ${target.status}.`);
      }
      if (caller.role === 'hr') {
        const canHrReviewFo =
          target.module === 'Assignment' &&
          target.requestedByRole === 'field_officer' &&
          getAuthorizedBranchIds(caller).includes(target.branchId) &&
          (hasUserPermission(caller, 'assignment.manage') ||
            hasUserPermission(caller, 'assignment.edit'));
        if (!canHrReviewFo) {
          throw new Error(
            'HR users can review Field Officer assignment actions within their branch; elevated HR/Master approvals require an Administrator.'
          );
        }
      }

      if (decision === 'Approved' && target.requestType === 'Site Deletion') {
        const siteRef = doc(firestoreDb!, 'sites', target.targetRecordId);
        const siteSnap = await tx.get(siteRef);
        if (siteSnap.exists()) {
          tx.update(siteRef, {
            siteStatus: 'Inactive',
            isArchived: true,
            archivedAt: nowIso,
            archivedBy: caller.uid,
            updatedAt: nowIso,
            serverUpdatedAt: serverTimestamp(),
          });
        }
      } else if (decision === 'Approved' && target.requestType === 'Client Deletion') {
        const clientRef = doc(firestoreDb!, 'clients', target.targetRecordId);
        const clientSnap = await tx.get(clientRef);
        if (clientSnap.exists()) {
          tx.update(clientRef, {
            clientStatus: 'Inactive',
            isArchived: true,
            updatedAt: nowIso,
            serverUpdatedAt: serverTimestamp(),
          });
        }
      } else if (decision === 'Approved' && target.requestType === 'Employee Deletion') {
        const empRef = doc(firestoreDb!, 'employees', target.targetRecordId);
        const empSnap = await tx.get(empRef);
        if (empSnap.exists()) {
          tx.update(empRef, {
            employeeStatus: 'Inactive',
            isActive: false,
            isDeleted: true,
            deletedAt: nowIso,
            deletedBy: caller.uid,
            updatedAt: nowIso,
            updatedBy: `${caller.fullName} (${caller.role})`,
            serverUpdatedAt: serverTimestamp(),
          });
        }
      }

      tx.update(aprRef, {
        status: decision,
        reviewedByUid: caller.uid,
        reviewedByName: caller.fullName,
        reviewRemarks: cleanRemarks,
        updatedAt: nowIso,
        decidedAt: nowIso,
        serverUpdatedAt: serverTimestamp(),
      });

      const logId = makeRuntimeLogId();
      tx.set(doc(firestoreDb!, 'auditLogs', logId), {
        ...buildAuditLogObject(caller, {
          logId,
          action: decision === 'Approved' ? 'Approval Approved' : 'Approval Rejected',
          module: 'Approvals',
          recordId: approvalId,
          branchId: target.branchId,
          summary: `${decision} request ${approvalId} (${target.requestType} on ${target.targetRecordId}). Remarks: ${cleanRemarks}`,
        }),
        createdAt: serverTimestamp(),
      });
    });
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function cancelApprovalRequest(
  caller: RexonUser,
  isPreviewSession: boolean,
  approvalId: string
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    const target = store.approvals.find((a) => a.approvalId === approvalId);
    if (!target) throw new Error(`Approval request ${approvalId} not found.`);
    if (target.status !== 'Pending') {
      throw new Error('Only Pending approval requests can be cancelled.');
    }
    if (caller.role !== 'admin' && target.requestedByUid !== caller.uid) {
      throw new Error('You can only cancel approval requests submitted by your own account.');
    }

    store.approvals = store.approvals.map((a) =>
      a.approvalId === approvalId
        ? {
            ...a,
            status: 'Cancelled',
            reviewRemarks: 'Cancelled by requester prior to review.',
            updatedAt: nowIso,
            decidedAt: nowIso,
          }
        : a
    );
    appendLocalAudit(store, caller, {
      action: 'Approval Cancelled',
      module: 'Approvals',
      recordId: approvalId,
      branchId: target.branchId,
      summary: `Cancelled pending approval request ${approvalId} (${target.requestType}).`,
    });
    writeLocalStore(store);
    return;
  }

  const path = `approvals/${approvalId}`;
  try {
    const aprRef = doc(firestoreDb!, 'approvals', approvalId);
    const snap = await getDoc(aprRef);
    if (!snap.exists()) throw new Error('Approval request not found.');
    const target = snap.data() as ApprovalRequestRecord;
    if (target.status !== 'Pending') {
      throw new Error('Only Pending approval requests can be cancelled.');
    }
    if (caller.role !== 'admin' && target.requestedByUid !== caller.uid) {
      throw new Error('Only the original requester or Admin can cancel this request.');
    }

    const batch = writeBatch(firestoreDb!);
    batch.update(aprRef, {
      status: 'Cancelled',
      reviewRemarks: 'Cancelled by requester prior to review.',
      updatedAt: nowIso,
      decidedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    });
    const logId = makeRuntimeLogId();
    batch.set(doc(firestoreDb!, 'auditLogs', logId), {
      ...buildAuditLogObject(caller, {
        logId,
        action: 'Approval Cancelled',
        module: 'Approvals',
        recordId: approvalId,
        branchId: target.branchId,
        summary: `Cancelled pending approval request ${approvalId} (${target.requestType}).`,
      }),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    notifyListeners();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

// ============================================================================
// 9. IMMUTABLE AUDIT LOGS (`auditLogs` COLLECTION — ADMIN READ ONLY; APPEND ONLY)
// ============================================================================
export async function listAuditLogs(
  caller: RexonUser,
  isPreviewSession: boolean
): Promise<AuditLogRecord[]> {
  if (caller.role !== 'admin') {
    return [];
  }

  if (!useLiveFirestore(isPreviewSession)) {
    const store = readLocalStore();
    return [...store.auditLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  const path = 'auditLogs';
  try {
    const snap = await getDocs(collection(firestoreDb!, path));
    return snap.docs
      .map((d) => {
        const raw = d.data() as Partial<AuditLogRecord> & {
          actorRole?: string;
          targetPath?: string;
        };
        return {
          logId: raw.logId || d.id,
          action: raw.action || 'System Event',
          module: (raw.module as AuditModuleName) || 'Branch',
          recordId: raw.recordId || raw.targetPath || d.id,
          performedBy: raw.performedBy || raw.actorUid || 'System',
          actorUid: raw.actorUid || '',
          role: (raw.role || raw.actorRole || 'admin') as RexonUser['role'],
          branchId: raw.branchId || 'ALL',
          timestamp: raw.timestamp || new Date().toISOString(),
          summary: raw.summary || `${raw.action ?? 'Action'} on ${raw.targetPath ?? d.id}`,
        };
      })
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}
