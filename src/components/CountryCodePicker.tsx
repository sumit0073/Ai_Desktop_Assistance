import { useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOM_COUNTRY_ISO,
  customSelection,
  digitsOnly,
  filterCountries,
  type PhoneCountrySelection,
} from "../lib/countryPhone";

type Props = {
  value: PhoneCountrySelection;
  onChange: (next: PhoneCountrySelection) => void;
};

export function CountryCodePicker({ value, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => filterCountries(query), [query]);
  const customDigits = digitsOnly(query).slice(0, 4);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const applyCustom = () => {
    if (!customDigits) return;
    onChange(customSelection(customDigits));
    setOpen(false);
  };

  return (
    <div className="country-picker" ref={rootRef}>
      <button
        type="button"
        className="country-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="country-picker__code">+{value.dialCode}</span>
        <span className="country-picker__meta">
          {value.iso === CUSTOM_COUNTRY_ISO ? "Custom" : value.iso}
        </span>
        <span className="country-picker__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="country-picker__menu" role="listbox" aria-label="Country codes">
          <div className="country-picker__search">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search India, +91, or type a code"
              aria-label="Search country code"
            />
          </div>

          {customDigits.length > 0 && (
            <button
              type="button"
              className="country-picker__option country-picker__option--custom"
              onClick={applyCustom}
            >
              <span className="country-picker__option-code">+{customDigits}</span>
              <span className="country-picker__option-name">
                Use custom code
              </span>
            </button>
          )}

          <div className="country-picker__list">
            {results.length === 0 && (
              <p className="country-picker__empty">
                No countries found. Type digits to use a custom code.
              </p>
            )}
            {results.map((country) => {
              const active =
                value.iso === country.iso ||
                (value.iso === CUSTOM_COUNTRY_ISO &&
                  value.dialCode === country.dialCode);
              return (
                <button
                  key={`${country.iso}-${country.dialCode}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`country-picker__option ${active ? "is-active" : ""}`}
                  onClick={() => {
                    onChange({ ...country });
                    setOpen(false);
                  }}
                >
                  <span className="country-picker__option-code">
                    +{country.dialCode}
                  </span>
                  <span className="country-picker__option-name">
                    {country.name}
                    <em>{country.iso}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
