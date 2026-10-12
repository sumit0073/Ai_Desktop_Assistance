export type CountryPhone = {
  iso: string;
  name: string;
  dialCode: string; // digits only, e.g. "91"
  nationalLength: number;
  placeholder: string;
};

export type PhoneCountrySelection = {
  iso: string;
  name: string;
  dialCode: string;
  nationalLength: number;
  placeholder: string;
};

function ph(
  iso: string,
  name: string,
  dialCode: string,
  nationalLength: number,
  placeholder?: string,
): CountryPhone {
  return {
    iso,
    name,
    dialCode,
    nationalLength,
    placeholder: placeholder ?? "0".repeat(Math.min(nationalLength, 10)),
  };
}

/** Broad country dialing list with typical national mobile lengths. */
export const COUNTRY_PHONES: CountryPhone[] = [
  ph("AF", "Afghanistan", "93", 9),
  ph("AL", "Albania", "355", 9),
  ph("DZ", "Algeria", "213", 9),
  ph("AD", "Andorra", "376", 6),
  ph("AO", "Angola", "244", 9),
  ph("AR", "Argentina", "54", 10),
  ph("AM", "Armenia", "374", 8),
  ph("AU", "Australia", "61", 9, "412345678"),
  ph("AT", "Austria", "43", 10),
  ph("AZ", "Azerbaijan", "994", 9),
  ph("BH", "Bahrain", "973", 8),
  ph("BD", "Bangladesh", "880", 10, "1712345678"),
  ph("BY", "Belarus", "375", 9),
  ph("BE", "Belgium", "32", 9),
  ph("BZ", "Belize", "501", 7),
  ph("BJ", "Benin", "229", 8),
  ph("BT", "Bhutan", "975", 8),
  ph("BO", "Bolivia", "591", 8),
  ph("BA", "Bosnia and Herzegovina", "387", 8),
  ph("BW", "Botswana", "267", 8),
  ph("BR", "Brazil", "55", 11, "11987654321"),
  ph("BN", "Brunei", "673", 7),
  ph("BG", "Bulgaria", "359", 9),
  ph("KH", "Cambodia", "855", 9),
  ph("CM", "Cameroon", "237", 9),
  ph("CA", "Canada", "1", 10, "4165550123"),
  ph("CL", "Chile", "56", 9),
  ph("CN", "China", "86", 11),
  ph("CO", "Colombia", "57", 10),
  ph("CR", "Costa Rica", "506", 8),
  ph("HR", "Croatia", "385", 9),
  ph("CU", "Cuba", "53", 8),
  ph("CY", "Cyprus", "357", 8),
  ph("CZ", "Czechia", "420", 9),
  ph("DK", "Denmark", "45", 8),
  ph("DO", "Dominican Republic", "1", 10),
  ph("EC", "Ecuador", "593", 9),
  ph("EG", "Egypt", "20", 10),
  ph("SV", "El Salvador", "503", 8),
  ph("EE", "Estonia", "372", 8),
  ph("ET", "Ethiopia", "251", 9),
  ph("FI", "Finland", "358", 9),
  ph("FR", "France", "33", 9, "612345678"),
  ph("GE", "Georgia", "995", 9),
  ph("DE", "Germany", "49", 11, "15123456789"),
  ph("GH", "Ghana", "233", 9),
  ph("GR", "Greece", "30", 10),
  ph("GT", "Guatemala", "502", 8),
  ph("HN", "Honduras", "504", 8),
  ph("HK", "Hong Kong", "852", 8),
  ph("HU", "Hungary", "36", 9),
  ph("IS", "Iceland", "354", 7),
  ph("IN", "India", "91", 10, "98765 43210"),
  ph("ID", "Indonesia", "62", 11, "81234567890"),
  ph("IR", "Iran", "98", 10),
  ph("IQ", "Iraq", "964", 10),
  ph("IE", "Ireland", "353", 9),
  ph("IL", "Israel", "972", 9),
  ph("IT", "Italy", "39", 10),
  ph("JM", "Jamaica", "1", 10),
  ph("JP", "Japan", "81", 10, "9012345678"),
  ph("JO", "Jordan", "962", 9),
  ph("KZ", "Kazakhstan", "7", 10),
  ph("KE", "Kenya", "254", 9),
  ph("KW", "Kuwait", "965", 8),
  ph("KG", "Kyrgyzstan", "996", 9),
  ph("LA", "Laos", "856", 10),
  ph("LV", "Latvia", "371", 8),
  ph("LB", "Lebanon", "961", 8),
  ph("LY", "Libya", "218", 9),
  ph("LT", "Lithuania", "370", 8),
  ph("LU", "Luxembourg", "352", 9),
  ph("MO", "Macau", "853", 8),
  ph("MG", "Madagascar", "261", 9),
  ph("MY", "Malaysia", "60", 9, "123456789"),
  ph("MV", "Maldives", "960", 7),
  ph("MT", "Malta", "356", 8),
  ph("MX", "Mexico", "52", 10),
  ph("MD", "Moldova", "373", 8),
  ph("MC", "Monaco", "377", 8),
  ph("MN", "Mongolia", "976", 8),
  ph("ME", "Montenegro", "382", 8),
  ph("MA", "Morocco", "212", 9),
  ph("MM", "Myanmar", "95", 9),
  ph("NP", "Nepal", "977", 10, "9841234567"),
  ph("NL", "Netherlands", "31", 9),
  ph("NZ", "New Zealand", "64", 9, "211234567"),
  ph("NI", "Nicaragua", "505", 8),
  ph("NG", "Nigeria", "234", 10),
  ph("KP", "North Korea", "850", 10),
  ph("MK", "North Macedonia", "389", 8),
  ph("NO", "Norway", "47", 8),
  ph("OM", "Oman", "968", 8),
  ph("PK", "Pakistan", "92", 10, "3001234567"),
  ph("PS", "Palestine", "970", 9),
  ph("PA", "Panama", "507", 8),
  ph("PY", "Paraguay", "595", 9),
  ph("PE", "Peru", "51", 9),
  ph("PH", "Philippines", "63", 10, "9171234567"),
  ph("PL", "Poland", "48", 9),
  ph("PT", "Portugal", "351", 9),
  ph("PR", "Puerto Rico", "1", 10),
  ph("QA", "Qatar", "974", 8),
  ph("RO", "Romania", "40", 9),
  ph("RU", "Russia", "7", 10),
  ph("RW", "Rwanda", "250", 9),
  ph("SA", "Saudi Arabia", "966", 9),
  ph("SN", "Senegal", "221", 9),
  ph("RS", "Serbia", "381", 9),
  ph("SG", "Singapore", "65", 8, "81234567"),
  ph("SK", "Slovakia", "421", 9),
  ph("SI", "Slovenia", "386", 8),
  ph("ZA", "South Africa", "27", 9, "821234567"),
  ph("KR", "South Korea", "82", 10),
  ph("ES", "Spain", "34", 9),
  ph("LK", "Sri Lanka", "94", 9, "712345678"),
  ph("SD", "Sudan", "249", 9),
  ph("SE", "Sweden", "46", 9),
  ph("CH", "Switzerland", "41", 9),
  ph("SY", "Syria", "963", 9),
  ph("TW", "Taiwan", "886", 9),
  ph("TJ", "Tajikistan", "992", 9),
  ph("TZ", "Tanzania", "255", 9),
  ph("TH", "Thailand", "66", 9),
  ph("TT", "Trinidad and Tobago", "1", 10),
  ph("TN", "Tunisia", "216", 8),
  ph("TR", "Turkey", "90", 10),
  ph("TM", "Turkmenistan", "993", 8),
  ph("UG", "Uganda", "256", 9),
  ph("UA", "Ukraine", "380", 9),
  ph("AE", "United Arab Emirates", "971", 9, "501234567"),
  ph("GB", "United Kingdom", "44", 10, "7400123456"),
  ph("US", "United States", "1", 10, "2025550147"),
  ph("UY", "Uruguay", "598", 8),
  ph("UZ", "Uzbekistan", "998", 9),
  ph("VE", "Venezuela", "58", 10),
  ph("VN", "Vietnam", "84", 9),
  ph("YE", "Yemen", "967", 9),
  ph("ZM", "Zambia", "260", 9),
  ph("ZW", "Zimbabwe", "263", 9),
].sort((a, b) => a.name.localeCompare(b.name));

export const DEFAULT_COUNTRY_ISO = "IN";
export const CUSTOM_COUNTRY_ISO = "CUSTOM";
export const CUSTOM_NATIONAL_LENGTH = 10;

export function getCountryByIso(iso: string): CountryPhone {
  return (
    COUNTRY_PHONES.find((c) => c.iso === iso) ??
    COUNTRY_PHONES.find((c) => c.iso === DEFAULT_COUNTRY_ISO)!
  );
}

export function getDefaultSelection(): PhoneCountrySelection {
  return getCountryByIso(DEFAULT_COUNTRY_ISO);
}

export function selectionFromCountry(country: CountryPhone): PhoneCountrySelection {
  return { ...country };
}

export function customSelection(dialCode: string): PhoneCountrySelection {
  const code = digitsOnly(dialCode).slice(0, 4) || "91";
  return {
    iso: CUSTOM_COUNTRY_ISO,
    name: "Custom code",
    dialCode: code,
    nationalLength: CUSTOM_NATIONAL_LENGTH,
    placeholder: "0".repeat(CUSTOM_NATIONAL_LENGTH),
  };
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatPhoneE164(dialCode: string, nationalNumber: string): string {
  return `+${digitsOnly(dialCode)}${digitsOnly(nationalNumber)}`;
}

export function filterCountries(query: string): CountryPhone[] {
  const q = query.trim().toLowerCase();
  if (!q) return COUNTRY_PHONES;

  const qDigits = digitsOnly(q);
  return COUNTRY_PHONES.filter((country) => {
    const haystack = `${country.name} ${country.iso} +${country.dialCode} ${country.dialCode}`.toLowerCase();
    if (haystack.includes(q)) return true;
    if (qDigits && country.dialCode.includes(qDigits)) return true;
    return false;
  });
}
