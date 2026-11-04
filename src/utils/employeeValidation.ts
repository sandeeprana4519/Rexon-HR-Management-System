import {
  DesignationRecord,
  EMPLOYEE_DOCUMENT_TYPES,
  EmployeeDocumentType,
  EmployeeFormInput,
  RexonUser,
  ValidationResult,
} from '../types';
import { hasUserPermission } from './portalConfig';
import { sanitizeInput, validateEmail, validateFullName, validatePhone } from './validation';

const PIN_REGEX = /^[1-9][0-9]{5}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const AADHAAR_REGEX = /^[2-9][0-9]{11}$/;
const BANK_ACC_REGEX = /^[0-9]{9,18}$/;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB (supports phone camera photos)

export function requirementNeedsVerification(rawRequirement: string | undefined): boolean {
  if (!rawRequirement) return false;
  const cleaned = rawRequirement.trim();
  if (!cleaned) return false;
  return !/^(none|not required|no license|n\/a|na|nil|optional|-|—)$/i.test(cleaned);
}

export function maskAadhaarNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function maskBankAccount(raw: string): string {
  const digits = raw.replace(/\s+/g, '');
  if (digits.length < 4) return '';
  const visible = digits.slice(-4);
  const maskedLen = Math.max(4, digits.length - 4);
  return `${'X'.repeat(maskedLen)}${visible}`;
}

export function calculateAgeYears(dobIso: string): number | null {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

export function validateEmployeeForm(
  input: EmployeeFormInput,
  availableDesignations: DesignationRecord[],
  caller: RexonUser
): ValidationResult {
  // A. Personal Information checks
  const nameCheck = validateFullName(input.fullName);
  if (!nameCheck.valid) return nameCheck;

  if (sanitizeInput(input.fatherOrSpouseName, 120).length < 2) {
    return { valid: false, error: "Father's / Spouse's name is required (minimum 2 characters)." };
  }

  if (!input.dateOfBirth) {
    return { valid: false, error: 'Date of Birth is required.' };
  }
  const age = calculateAgeYears(input.dateOfBirth);
  if (age === null || age < 18 || age > 75) {
    return {
      valid: false,
      error: 'Employee must be at least 18 years old (and under 75 years) for security/manpower deployment.',
    };
  }

  const mobileCheck = validatePhone(input.mobile);
  if (!mobileCheck.valid) {
    return { valid: false, error: `Primary Mobile: ${mobileCheck.error}` };
  }

  if (input.alternateMobile.trim()) {
    const altCheck = validatePhone(input.alternateMobile);
    if (!altCheck.valid) {
      return { valid: false, error: `Alternate Mobile: ${altCheck.error}` };
    }
  }

  if (input.email.trim()) {
    const emailCheck = validateEmail(input.email);
    if (!emailCheck.valid) return emailCheck;
  }

  if (sanitizeInput(input.currentAddress, 300).length < 5) {
    return { valid: false, error: 'Current residential address is required (minimum 5 characters).' };
  }

  if (sanitizeInput(input.permanentAddress, 300).length < 5) {
    return { valid: false, error: 'Permanent address is required (minimum 5 characters).' };
  }

  if (sanitizeInput(input.city, 80).length < 2) {
    return { valid: false, error: 'City is required.' };
  }

  if (sanitizeInput(input.state, 80).length < 2) {
    return { valid: false, error: 'State is required.' };
  }

  if (!PIN_REGEX.test(input.pinCode.trim())) {
    return { valid: false, error: 'Enter a valid 6-digit Indian PIN code.' };
  }

  if (sanitizeInput(input.emergencyContactName, 120).length < 2) {
    return { valid: false, error: 'Emergency contact person name is required.' };
  }

  const emergencyPhoneCheck = validatePhone(input.emergencyContactNumber);
  if (!emergencyPhoneCheck.valid) {
    return { valid: false, error: `Emergency Contact Number: ${emergencyPhoneCheck.error}` };
  }

  // B. Employment & Dynamic Service / Designation Eligibility checks
  if (!input.joiningDate) {
    return { valid: false, error: 'Joining date is required.' };
  }

  if (!input.branchId.trim()) {
    return { valid: false, error: 'Assigned Branch is required.' };
  }

  if (!input.selectedDesignationIds || input.selectedDesignationIds.length === 0) {
    return {
      valid: false,
      error: 'Select at least one authorized Service Designation for the employee.',
    };
  }

  // Multiple designation permission gate
  if (
    input.selectedDesignationIds.length > 1 &&
    !hasUserPermission(caller, 'employee.multi_designation')
  ) {
    return {
      valid: false,
      error:
        'Assigning multiple designations requires Admin authority or HR "employee.multi_designation" permission.',
    };
  }

  const chosenDesignations = input.selectedDesignationIds
    .map((id) => availableDesignations.find((d) => d.designationId === id))
    .filter((d): d is DesignationRecord => Boolean(d));

  if (chosenDesignations.length !== input.selectedDesignationIds.length) {
    return {
      valid: false,
      error: 'One or more selected designations could not be verified in the Master Designation catalog.',
    };
  }

  // Verify mandatory Qualification, Training, and License criteria for EVERY selected designation
  for (const desig of chosenDesignations) {
    if (desig.status !== 'Active') {
      return {
        valid: false,
        error: `Designation "${desig.designationName}" is currently Inactive and cannot be assigned.`,
      };
    }

    const confirm = input.eligibilityConfirmations[desig.designationId] ?? {
      qualificationVerified: false,
      trainingVerified: false,
      licenseVerified: false,
    };

    if (requirementNeedsVerification(desig.qualification)) {
      if (sanitizeInput(input.qualification, 200).length < 2) {
        return {
          valid: false,
          error: `Designation "${desig.designationName}" requires qualification (${desig.qualification}). Enter the employee's qualification details.`,
        };
      }
      if (!confirm.qualificationVerified) {
        return {
          valid: false,
          error: `Confirm that the employee meets the mandatory qualification (${desig.qualification}) for "${desig.designationName}".`,
        };
      }
    }

    if (requirementNeedsVerification(desig.trainingRequirements)) {
      if (sanitizeInput(input.trainingDetails, 250).length < 2) {
        return {
          valid: false,
          error: `Designation "${desig.designationName}" requires training (${desig.trainingRequirements}). Enter completed training details before assignment.`,
        };
      }
      if (!confirm.trainingVerified) {
        return {
          valid: false,
          error: `Confirm completion of mandatory training (${desig.trainingRequirements}) for "${desig.designationName}".`,
        };
      }
    }

    if (requirementNeedsVerification(desig.licenseRequirements)) {
      if (sanitizeInput(input.licenseDetails, 250).length < 3) {
        return {
          valid: false,
          error: `Assignment Blocked: "${desig.designationName}" mandates "${desig.licenseRequirements}". Enter valid license / PVC reference details.`,
        };
      }
      if (!confirm.licenseVerified) {
        return {
          valid: false,
          error: `Assignment Blocked: Confirm mandatory license/clearance verification (${desig.licenseRequirements}) for "${desig.designationName}".`,
        };
      }
    }
  }

  // C. Sensitive Financial & KYC Validation (when included)
  if (input.includePrivateFinancials) {
    const basicNum = Number(input.basicSalary);
    if (!input.basicSalary.trim() || Number.isNaN(basicNum) || basicNum <= 0 || basicNum > 500000) {
      return {
        valid: false,
        error: 'Enter a valid Basic Salary amount greater than ₹0 (up to ₹5,00,000).',
      };
    }

    const cleanAcc = input.bankAccountNumber.replace(/\s+/g, '');
    if (cleanAcc && !BANK_ACC_REGEX.test(cleanAcc)) {
      return {
        valid: false,
        error: 'Bank Account Number must contain 9 to 18 digits.',
      };
    }

    if (cleanAcc) {
      if (sanitizeInput(input.bankAccountHolderName, 120).length < 2) {
        return { valid: false, error: 'Bank Account Holder Name is required when Bank Account is entered.' };
      }
      if (sanitizeInput(input.bankName, 120).length < 2) {
        return { valid: false, error: 'Bank Name is required when Bank Account is entered.' };
      }
      const upperIfsc = input.ifscCode.trim().toUpperCase();
      if (!IFSC_REGEX.test(upperIfsc)) {
        return {
          valid: false,
          error: 'Enter a valid 11-character Bank IFSC code (e.g. SBIN0001234).',
        };
      }
    }

    const upperPan = input.panNumber.trim().toUpperCase();
    if (upperPan && !PAN_REGEX.test(upperPan)) {
      return {
        valid: false,
        error: 'Enter a valid 10-character PAN number (e.g. ABCDE1234F).',
      };
    }

    const cleanAadhaar = input.aadhaarNumber.replace(/[\s-]/g, '');
    if (cleanAadhaar && !AADHAAR_REGEX.test(cleanAadhaar)) {
      return {
        valid: false,
        error: 'Enter a valid 12-digit Aadhaar number (cannot start with 0 or 1).',
      };
    }
  }

  return { valid: true };
}

export function validateEmployeeDocumentFile(
  file: File | null,
  documentType: EmployeeDocumentType
): ValidationResult {
  if (!EMPLOYEE_DOCUMENT_TYPES.includes(documentType)) {
    return { valid: false, error: 'Select a valid document category.' };
  }
  if (!file) {
    return { valid: false, error: 'Select a PDF or image file to upload.' };
  }
  const isImageByTypeOrExt =
    (file.type && file.type.startsWith('image/')) ||
    /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name || '');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

  if (documentType === 'Photograph') {
    if (!isImageByTypeOrExt) {
      return {
        valid: false,
        error: 'Employee Photograph must be an image file (JPG, PNG, or WEBP).',
      };
    }
  } else if (!isImageByTypeOrExt && !isPdf) {
    return {
      valid: false,
      error: 'Unsupported file format. Upload PDF, JPG, PNG, or WEBP files only.',
    };
  }

  if (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File size exceeds the 15 MB limit. Please select a file under 15 MB.',
    };
  }
  return { valid: true };
}
