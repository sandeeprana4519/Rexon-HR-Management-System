import {
  BranchFormInput,
  BranchRecord,
  ClientFormInput,
  ClientRecord,
  DesignationFormInput,
  DesignationRecord,
  FieldOfficerFormInput,
  FieldOfficerRecord,
  HRProfileFormInput,
  HRProfileRecord,
  SERVICE_CATEGORIES,
  ServiceFormInput,
  ServiceRecord,
  SiteFormInput,
  SiteRecord,
  SiteServiceConfigFormInput,
  SiteServiceConfigRecord,
  SubmitApprovalInput,
  ValidationResult,
} from '../types';
import { validateEmail, validatePhone, validateRequiredText } from './validation';

const PIN_CODE_REGEX = /^[1-9][0-9]{5}$/;
const BRANCH_CODE_REGEX = /^[A-Z0-9][A-Z0-9\-_]{1,19}$/;
const SERVICE_CODE_REGEX = /^[A-Z0-9][A-Z0-9\-_]{1,19}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const COORD_REGEX = /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

export function normalizeCode(val: string): string {
  return val.trim().toUpperCase();
}

export function computeNonNegativeVacancy(requiredCount: number, deployedCount: number): number {
  const req = Number.isFinite(requiredCount) ? Math.max(0, Math.floor(requiredCount)) : 0;
  const dep = Number.isFinite(deployedCount) ? Math.max(0, Math.floor(deployedCount)) : 0;
  return Math.max(0, req - dep);
}

export function validatePinCode(pin: string): ValidationResult {
  const cleaned = pin.trim();
  if (!PIN_CODE_REGEX.test(cleaned)) {
    return { valid: false, error: 'Enter a valid 6-digit Indian PIN code (e.g. 400001).' };
  }
  return { valid: true };
}

export function validateBranchForm(
  input: BranchFormInput,
  existingBranches: BranchRecord[],
  editingBranchId?: string
): ValidationResult {
  const nameCheck = validateRequiredText(input.branchName, 'Branch Name', 3, 120);
  if (!nameCheck.valid) return nameCheck;

  const code = normalizeCode(input.branchCode);
  if (!BRANCH_CODE_REGEX.test(code)) {
    return {
      valid: false,
      error: 'Branch Code must be 2–20 uppercase letters, digits, or hyphens (e.g. MUM-HQ).',
    };
  }

  const mgrCheck = validateRequiredText(input.managerName, 'Manager Name', 2, 100);
  if (!mgrCheck.valid) return mgrCheck;

  const mobileCheck = validatePhone(input.mobile);
  if (!mobileCheck.valid) return mobileCheck;

  const emailCheck = validateEmail(input.email);
  if (!emailCheck.valid) return emailCheck;

  const addrCheck = validateRequiredText(input.address, 'Address', 5, 250);
  if (!addrCheck.valid) return addrCheck;

  const cityCheck = validateRequiredText(input.city, 'City', 2, 80);
  if (!cityCheck.valid) return cityCheck;

  const stateCheck = validateRequiredText(input.state, 'State', 2, 80);
  if (!stateCheck.valid) return stateCheck;

  const pinCheck = validatePinCode(input.pinCode);
  if (!pinCheck.valid) return pinCheck;

  const duplicateCode = existingBranches.find(
    (b) => b.branchId !== editingBranchId && normalizeCode(b.branchCode) === code
  );
  if (duplicateCode) {
    return {
      valid: false,
      error: `Branch Code "${code}" is already assigned to ${duplicateCode.branchName} (${duplicateCode.branchId}).`,
    };
  }

  const duplicateNameCity = existingBranches.find(
    (b) =>
      !b.isDeleted &&
      b.branchId !== editingBranchId &&
      b.branchName.trim().toLowerCase() === input.branchName.trim().toLowerCase() &&
      b.city.trim().toLowerCase() === input.city.trim().toLowerCase()
  );
  if (duplicateNameCity) {
    return {
      valid: false,
      error: `A branch named "${input.branchName.trim()}" already exists in ${input.city.trim()} (${duplicateNameCity.branchCode}).`,
    };
  }

  return { valid: true };
}

export function validateHRProfileForm(
  input: HRProfileFormInput,
  existingHR: HRProfileRecord[],
  editingHrId?: string
): ValidationResult {
  const nameCheck = validateRequiredText(input.fullName, 'Full Name', 2, 120);
  if (!nameCheck.valid) return nameCheck;

  const trimmedEmail = input.email.trim();
  if (trimmedEmail.length > 0) {
    const emailCheck = validateEmail(trimmedEmail);
    if (!emailCheck.valid) return emailCheck;

    const dupEmail = existingHR.find(
      (h) => h.hrId !== editingHrId && h.email.trim().toLowerCase() === trimmedEmail.toLowerCase()
    );
    if (dupEmail) {
      return {
        valid: false,
        error: `Email "${trimmedEmail}" is already registered to HR account ${dupEmail.hrId} (${dupEmail.fullName}).`,
      };
    }
  }

  const mobileCheck = validatePhone(input.mobile);
  if (!mobileCheck.valid) return mobileCheck;

  if (!input.assignedBranches || input.assignedBranches.length === 0) {
    return { valid: false, error: 'Assign at least one operational Branch to this HR account.' };
  }

  if (!input.joiningDate) {
    return { valid: false, error: 'Joining Date is required.' };
  }

  const normalizedPhone = input.mobile.replace(/\D/g, '');
  const dupMobile = existingHR.find(
    (h) => h.hrId !== editingHrId && h.mobile.replace(/\D/g, '') === normalizedPhone
  );
  if (dupMobile) {
    return {
      valid: false,
      error: `Mobile number is already associated with HR account ${dupMobile.hrId} (${dupMobile.fullName}).`,
    };
  }

  return { valid: true };
}

export function validateClientForm(
  input: ClientFormInput,
  existingClients: ClientRecord[],
  editingClientId?: string
): ValidationResult {
  const compCheck = validateRequiredText(input.companyName, 'Company Name', 3, 150);
  if (!compCheck.valid) return compCheck;

  const dispCheck = validateRequiredText(input.displayName, 'Display Name', 2, 100);
  if (!dispCheck.valid) return dispCheck;

  const gst = normalizeCode(input.gstNumber);
  if (gst && gst !== 'UNREGISTERED' && !GSTIN_REGEX.test(gst)) {
    return {
      valid: false,
      error: 'Enter a valid 15-character GST Number (e.g. 27AABCU9603R1ZM) or leave blank if unregistered.',
    };
  }

  const pan = normalizeCode(input.panNumber);
  if (!pan || !PAN_REGEX.test(pan)) {
    return {
      valid: false,
      error: 'Enter a valid 10-character PAN Number (e.g. AABCU9603R).',
    };
  }

  const addrCheck = validateRequiredText(input.registeredAddress, 'Registered Address', 5, 300);
  if (!addrCheck.valid) return addrCheck;

  const cityCheck = validateRequiredText(input.city, 'City', 2, 80);
  if (!cityCheck.valid) return cityCheck;

  const stateCheck = validateRequiredText(input.state, 'State', 2, 80);
  if (!stateCheck.valid) return stateCheck;

  const pinCheck = validatePinCode(input.pinCode);
  if (!pinCheck.valid) return pinCheck;

  const cpCheck = validateRequiredText(input.contactPerson, 'Contact Person', 2, 100);
  if (!cpCheck.valid) return cpCheck;

  const desigCheck = validateRequiredText(input.contactDesignation, 'Contact Designation', 2, 80);
  if (!desigCheck.valid) return desigCheck;

  const mobCheck = validatePhone(input.mobile);
  if (!mobCheck.valid) return mobCheck;

  if (input.alternateMobile.trim()) {
    const altCheck = validatePhone(input.alternateMobile);
    if (!altCheck.valid) {
      return { valid: false, error: `Alternate Mobile: ${altCheck.error}` };
    }
  }

  const emailCheck = validateEmail(input.email);
  if (!emailCheck.valid) return emailCheck;

  const billAddrCheck = validateRequiredText(input.billingAddress, 'Billing Address', 5, 300);
  if (!billAddrCheck.valid) return billAddrCheck;

  const billContactCheck = validateRequiredText(input.billingContact, 'Billing Contact', 2, 100);
  if (!billContactCheck.valid) return billContactCheck;

  if (!input.contractStartDate || !input.contractEndDate) {
    return { valid: false, error: 'Contract Start Date and Contract End Date are required.' };
  }
  if (input.contractEndDate < input.contractStartDate) {
    return { valid: false, error: 'Contract End Date cannot be earlier than Contract Start Date.' };
  }

  if (!input.assignedBranch) {
    return { valid: false, error: 'Select an Assigned Branch for this Client.' };
  }

  if (gst && gst !== 'UNREGISTERED') {
    const dupGst = existingClients.find(
      (c) => !c.isArchived && c.clientId !== editingClientId && normalizeCode(c.gstNumber) === gst
    );
    if (dupGst) {
      return {
        valid: false,
        error: `GST Number "${gst}" is already registered under client ${dupGst.companyName} (${dupGst.clientId}).`,
      };
    }
  }

  const dupNameCity = existingClients.find(
    (c) =>
      !c.isArchived &&
      c.clientId !== editingClientId &&
      c.companyName.trim().toLowerCase() === input.companyName.trim().toLowerCase() &&
      c.city.trim().toLowerCase() === input.city.trim().toLowerCase()
  );
  if (dupNameCity) {
    return {
      valid: false,
      error: `Client "${input.companyName.trim()}" in ${input.city.trim()} already exists (${dupNameCity.clientId}).`,
    };
  }

  return { valid: true };
}

export function validateSiteForm(
  input: SiteFormInput,
  existingSites: SiteRecord[],
  editingSiteId?: string
): ValidationResult {
  if (!input.clientId) {
    return { valid: false, error: 'Every Site must belong to an existing Client. Select a Client first.' };
  }

  const siteNameCheck = validateRequiredText(input.siteName, 'Site Name', 3, 140);
  if (!siteNameCheck.valid) return siteNameCheck;

  if (!input.branchId) {
    return { valid: false, error: 'Branch ID is required for Site assignment.' };
  }

  const addrCheck = validateRequiredText(input.fullAddress, 'Full Address', 5, 300);
  if (!addrCheck.valid) return addrCheck;

  const cityCheck = validateRequiredText(input.city, 'City', 2, 80);
  if (!cityCheck.valid) return cityCheck;

  const stateCheck = validateRequiredText(input.state, 'State', 2, 80);
  if (!stateCheck.valid) return stateCheck;

  const pinCheck = validatePinCode(input.pinCode);
  if (!pinCheck.valid) return pinCheck;

  const mapsVal = input.googleMapsLocation.trim();
  if (mapsVal) {
    const isUrl =
      /^https?:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(
        mapsVal
      );
    const isCoord = COORD_REGEX.test(mapsVal);
    if (!isUrl && !isCoord) {
      return {
        valid: false,
        error:
          'Google Maps Location must be a valid Google Maps link (https://maps.google.com/...) or coordinates (e.g. 19.0760, 72.8777).',
      };
    }
  }

  const contactCheck = validateRequiredText(input.siteContactPerson, 'Site Contact Person', 2, 100);
  if (!contactCheck.valid) return contactCheck;

  const mgrNameCheck = validateRequiredText(input.siteManagerName, 'Site Manager Name', 2, 100);
  if (!mgrNameCheck.valid) return mgrNameCheck;

  const mgrMobCheck = validatePhone(input.managerMobile);
  if (!mgrMobCheck.valid) return { valid: false, error: `Manager Mobile: ${mgrMobCheck.error}` };

  if (input.managerEmail.trim().length > 0) {
    const mgrEmailCheck = validateEmail(input.managerEmail);
    if (!mgrEmailCheck.valid) return { valid: false, error: `Manager Email: ${mgrEmailCheck.error}` };
  }

  if (!input.startDate || !input.contractEndDate) {
    return { valid: false, error: 'Start Date and Contract End Date are required.' };
  }
  if (input.contractEndDate < input.startDate) {
    return { valid: false, error: 'Contract End Date cannot be earlier than Start Date.' };
  }

  const duplicateSite = existingSites.find(
    (s) =>
      !s.isArchived &&
      s.siteId !== editingSiteId &&
      s.clientId === input.clientId &&
      s.siteName.trim().toLowerCase() === input.siteName.trim().toLowerCase() &&
      (s.pinCode.trim() === input.pinCode.trim() ||
        s.city.trim().toLowerCase() === input.city.trim().toLowerCase())
  );

  if (duplicateSite) {
    return {
      valid: false,
      error: `Duplicate prevented: Site "${input.siteName.trim()}" already exists under client ${input.clientName} (${duplicateSite.siteId}).`,
    };
  }

  return { valid: true };
}

export function validateServiceForm(
  input: ServiceFormInput,
  existingServices: ServiceRecord[],
  editingServiceId?: string
): ValidationResult {
  const nameCheck = validateRequiredText(input.serviceName, 'Service Name', 2, 100);
  if (!nameCheck.valid) return nameCheck;

  if (!(SERVICE_CATEGORIES as readonly string[]).includes(input.serviceCategory)) {
    return {
      valid: false,
      error: 'Service Category must be Security, Housekeeping, or Manpower.',
    };
  }

  const code = normalizeCode(input.serviceCode);
  if (!SERVICE_CODE_REGEX.test(code)) {
    return {
      valid: false,
      error: 'Service Code must be 2–20 uppercase letters, numbers, or hyphens (e.g. SEC-GRD).',
    };
  }

  const descCheck = validateRequiredText(input.description, 'Service Description', 4, 300);
  if (!descCheck.valid) return descCheck;

  const dupName = existingServices.find(
    (s) =>
      s.serviceId !== editingServiceId &&
      s.serviceCategory === input.serviceCategory &&
      s.serviceName.trim().toLowerCase() === input.serviceName.trim().toLowerCase()
  );
  if (dupName) {
    return {
      valid: false,
      error: `Service "${input.serviceName.trim()}" already exists under ${input.serviceCategory} (${dupName.serviceId}).`,
    };
  }

  const dupCode = existingServices.find(
    (s) => s.serviceId !== editingServiceId && normalizeCode(s.serviceCode) === code
  );
  if (dupCode) {
    return {
      valid: false,
      error: `Service Code "${code}" is already used by ${dupCode.serviceName} (${dupCode.serviceId}).`,
    };
  }

  return { valid: true };
}

export function validateDesignationForm(
  input: DesignationFormInput,
  existingDesignations: DesignationRecord[],
  editingDesignationId?: string
): ValidationResult {
  const nameCheck = validateRequiredText(input.designationName, 'Designation Name', 2, 100);
  if (!nameCheck.valid) return nameCheck;

  if (!(SERVICE_CATEGORIES as readonly string[]).includes(input.serviceCategory)) {
    return {
      valid: false,
      error: 'Select a valid Service Category (Security, Housekeeping, or Manpower).',
    };
  }

  if (!input.relatedServiceId || !input.relatedServiceName.trim()) {
    return {
      valid: false,
      error: 'Select a Related Service under the chosen Service Category.',
    };
  }

  const descCheck = validateRequiredText(input.description, 'Description', 4, 300);
  if (!descCheck.valid) return descCheck;

  const skillsCheck = validateRequiredText(input.requiredSkills, 'Required Skills', 2, 250);
  if (!skillsCheck.valid) return skillsCheck;

  const qualCheck = validateRequiredText(input.qualification, 'Qualification', 2, 160);
  if (!qualCheck.valid) return qualCheck;

  const trainingCheck = validateRequiredText(
    input.trainingRequirements,
    'Training Requirements',
    2,
    200
  );
  if (!trainingCheck.valid) return trainingCheck;

  const licenseCheck = validateRequiredText(
    input.licenseRequirements,
    'License Requirements',
    2,
    200
  );
  if (!licenseCheck.valid) return licenseCheck;

  const dup = existingDesignations.find(
    (d) =>
      d.designationId !== editingDesignationId &&
      d.serviceCategory === input.serviceCategory &&
      d.designationName.trim().toLowerCase() === input.designationName.trim().toLowerCase()
  );
  if (dup) {
    return {
      valid: false,
      error: `Designation "${input.designationName.trim()}" already exists in ${input.serviceCategory} (${dup.designationId}).`,
    };
  }

  return { valid: true };
}

export function validateSiteServiceConfigForm(
  input: SiteServiceConfigFormInput,
  existingConfigs: SiteServiceConfigRecord[],
  editingConfigId?: string
): ValidationResult {
  if (!input.siteId) {
    return { valid: false, error: 'Target Site ID is required.' };
  }
  if (!(SERVICE_CATEGORIES as readonly string[]).includes(input.serviceCategory)) {
    return { valid: false, error: 'Select a valid Service Category.' };
  }
  if (!input.serviceId || !input.serviceName.trim()) {
    return { valid: false, error: 'Select an authorized Service Name.' };
  }
  if (!input.designationId || !input.designationName.trim()) {
    return { valid: false, error: 'Select a Designation for this Site service post.' };
  }
  if (!Number.isInteger(input.requiredCount) || input.requiredCount < 1 || input.requiredCount > 5000) {
    return {
      valid: false,
      error: 'Required Employee Count must be a whole number between 1 and 5,000.',
    };
  }
  if (!Number.isInteger(input.deployedCount) || input.deployedCount < 0) {
    return {
      valid: false,
      error: 'Deployed Count must be 0 or a positive whole number.',
    };
  }
  if (input.deployedCount > input.requiredCount) {
    return {
      valid: false,
      error: `Deployed Count (${input.deployedCount}) cannot exceed Required Count (${input.requiredCount}). Negative vacancy counts are strictly prohibited.`,
    };
  }
  if (!input.shiftType.trim()) {
    return { valid: false, error: 'Shift Type is required.' };
  }
  if (!input.workingHours.trim()) {
    return { valid: false, error: 'Working Hours are required.' };
  }
  if (!input.weeklyOff.trim()) {
    return { valid: false, error: 'Weekly Off schedule is required.' };
  }
  if (!input.serviceStartDate || !input.serviceEndDate) {
    return { valid: false, error: 'Service Start Date and Service End Date are required.' };
  }
  if (input.serviceEndDate < input.serviceStartDate) {
    return {
      valid: false,
      error: 'Service End Date cannot be earlier than Service Start Date.',
    };
  }

  const dup = existingConfigs.find(
    (cfg) =>
      cfg.siteServiceId !== editingConfigId &&
      cfg.siteId === input.siteId &&
      cfg.designationId === input.designationId &&
      cfg.shiftType.trim().toLowerCase() === input.shiftType.trim().toLowerCase()
  );
  if (dup) {
    return {
      valid: false,
      error: `Designation "${input.designationName}" (${input.shiftType}) is already configured on this Site (${dup.siteServiceId}). Edit the existing post line instead.`,
    };
  }

  return { valid: true };
}

export function validateApprovalSubmission(input: SubmitApprovalInput): ValidationResult {
  const sumCheck = validateRequiredText(input.summary, 'Request Summary', 5, 160);
  if (!sumCheck.valid) return sumCheck;

  const reasonCheck = validateRequiredText(input.reason, 'Operational Justification', 8, 400);
  if (!reasonCheck.valid) return reasonCheck;

  if (!input.branchId.trim()) {
    return { valid: false, error: 'Branch ID is required for approval routing.' };
  }

  if (!input.targetRecordId.trim()) {
    return { valid: false, error: 'Target Record ID is required.' };
  }

  return { valid: true };
}

export function validateFieldOfficerForm(
  input: FieldOfficerFormInput,
  existingOfficers: FieldOfficerRecord[],
  editingUid?: string
): ValidationResult {
  const nameCheck = validateRequiredText(input.fullName, 'Field Officer Full Name', 2, 100);
  if (!nameCheck.valid) return nameCheck;

  const phoneCheck = validatePhone(input.phone);
  if (!phoneCheck.valid) return { valid: false, error: `Mobile Number: ${phoneCheck.error}` };

  if (input.email.trim().length > 0) {
    const emailCheck = validateEmail(input.email);
    if (!emailCheck.valid) return { valid: false, error: `Email Address: ${emailCheck.error}` };
  }

  if (!input.branchId.trim() && (!input.assignedBranches || input.assignedBranches.length === 0)) {
    return { valid: false, error: 'Select at least one Authorized Branch for this Field Officer.' };
  }

  const trimmedPwd = (input.initialPassword ?? '').trim();
  if (trimmedPwd.length > 0 && trimmedPwd.length < 6) {
    return { valid: false, error: 'Portal Login Password must be at least 6 characters long.' };
  }

  const normalizedPhone = input.phone.replace(/\D/g, '');
  const dupPhone = existingOfficers.find(
    (fo) => fo.uid !== editingUid && fo.phone.replace(/\D/g, '') === normalizedPhone
  );
  if (dupPhone) {
    return {
      valid: false,
      error: `Duplicate prevented: Mobile number ${input.phone.trim()} is already registered to ${dupPhone.fullName} (${dupPhone.fieldOfficerId}).`,
    };
  }

  if (input.email.trim().length > 0) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const dupEmail = existingOfficers.find(
      (fo) => fo.uid !== editingUid && fo.email.trim().toLowerCase() === normalizedEmail
    );
    if (dupEmail) {
      return {
        valid: false,
        error: `Duplicate prevented: Email "${input.email.trim()}" is already assigned to ${dupEmail.fullName} (${dupEmail.fieldOfficerId}).`,
      };
    }
  }

  return { valid: true };
}

export function buildGoogleMapsHref(locationValue: string, fallbackAddress: string): string {
  const trimmed = locationValue.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackAddress)}`;
}
