import { ValidationResult } from '../types';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/;

export function sanitizeInput(value: string, maxLength = 200): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) {
    return { valid: false, error: 'Email address is required.' };
  }
  if (trimmed.length > 160 || !EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: 'Enter a valid business or personal email address.' };
  }
  return { valid: true };
}

export function validateLoginPassword(password: string): ValidationResult {
  if (!password || password.length === 0) {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters.' };
  }
  return { valid: true };
}

export function validateNewPassword(password: string, confirmPassword: string): ValidationResult {
  if (!password || password.length < 8) {
    return { valid: false, error: 'New password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters.' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      valid: false,
      error: 'Include at least one uppercase letter, one lowercase letter, and one number.',
    };
  }
  if (password !== confirmPassword) {
    return { valid: false, error: 'Confirmation password does not match.' };
  }
  return { valid: true };
}

export function validateFullName(name: string): ValidationResult {
  const cleaned = sanitizeInput(name, 120);
  if (cleaned.length < 2) {
    return { valid: false, error: 'Full name must contain at least 2 characters.' };
  }
  return { valid: true };
}

export function validatePhone(phone: string): ValidationResult {
  const cleaned = phone.trim();
  if (!cleaned) {
    return { valid: false, error: 'Contact phone number is required.' };
  }
  if (!PHONE_REGEX.test(cleaned)) {
    return {
      valid: false,
      error: 'Enter a valid phone number (7 to 20 digits, optional + country code).',
    };
  }
  return { valid: true };
}

export function validateRequiredText(value: string, label: string, minLen = 3, maxLen = 300): ValidationResult {
  const cleaned = sanitizeInput(value, maxLen + 10);
  if (cleaned.length < minLen) {
    return { valid: false, error: `${label} must be at least ${minLen} characters.` };
  }
  if (cleaned.length > maxLen) {
    return { valid: false, error: `${label} must not exceed ${maxLen} characters.` };
  }
  return { valid: true };
}

export function validatePositiveAmount(raw: string, maxAmount = 250000): ValidationResult {
  const num = Number(raw);
  if (!raw.trim() || Number.isNaN(num) || num <= 0) {
    return { valid: false, error: 'Enter a valid amount greater than 0.' };
  }
  if (num > maxAmount) {
    return {
      valid: false,
      error: `Requested amount cannot exceed ₹${maxAmount.toLocaleString('en-IN')}.`,
    };
  }
  return { valid: true };
}
