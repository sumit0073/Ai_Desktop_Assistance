import type { CountryCode } from "libphonenumber-js";
import { isValidPhoneNumber } from "react-phone-number-input";
import {
  CUSTOM_COUNTRY_ISO,
  digitsOnly,
  formatPhoneE164,
  type PhoneCountrySelection,
} from "./countryPhone";

export type PhoneFeasibility = "empty" | "incomplete" | "invalid" | "valid";

function isObviouslyFake(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true;
  if (/^0+$/.test(digits)) return true;
  const asc = "01234567890123456789";
  const desc = "98765432109876543210";
  if (digits.length >= 6 && (asc.includes(digits) || desc.includes(digits))) {
    return true;
  }
  return false;
}

/** India mobiles are 10 digits starting with 6–9. */
function passesCountryMobileRules(
  digits: string,
  country: PhoneCountrySelection,
): boolean {
  if (country.iso === "IN") {
    return /^[6-9]\d{9}$/.test(digits);
  }
  return true;
}

function isStrictlyValid(
  nationalDigits: string,
  country: PhoneCountrySelection,
): boolean {
  if (isObviouslyFake(nationalDigits)) return false;
  if (!passesCountryMobileRules(nationalDigits, country)) return false;

  const e164 = formatPhoneE164(country.dialCode, nationalDigits);

  if (country.iso !== CUSTOM_COUNTRY_ISO && country.iso.length === 2) {
    return (
      isValidPhoneNumber(e164, country.iso as CountryCode) ||
      isValidPhoneNumber(e164)
    );
  }

  return isValidPhoneNumber(e164);
}

/** Live feasibility for optional UI state (no helper copy required). */
export function getPhoneFeasibility(
  nationalNumber: string,
  country: PhoneCountrySelection,
): PhoneFeasibility {
  const digits = digitsOnly(nationalNumber);
  if (!digits) return "empty";
  if (digits.length < country.nationalLength) return "incomplete";
  if (digits.length > country.nationalLength) return "invalid";
  return isStrictlyValid(digits, country) ? "valid" : "invalid";
}

/**
 * Strict check via react-phone-number-input `isValidPhoneNumber`,
 * plus rejection of placeholder / consecutive digit sequences.
 */
export function validateFeasiblePhone(
  nationalNumber: string,
  country: PhoneCountrySelection,
): string | null {
  const digits = digitsOnly(nationalNumber);

  if (!digits) return "Phone number is required.";
  if (!country.dialCode) return "Country code is required.";

  if (digits.length !== country.nationalLength) {
    return `Enter a ${country.nationalLength}-digit phone number.`;
  }

  if (isObviouslyFake(digits)) {
    return "That looks like a placeholder. Enter a real phone number.";
  }

  if (!passesCountryMobileRules(digits, country)) {
    return "Enter a valid mobile number for the selected country.";
  }

  if (!isStrictlyValid(digits, country)) {
    return "Enter a valid phone number for the selected country.";
  }

  return null;
}
