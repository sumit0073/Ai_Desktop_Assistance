import { useMemo, useState, type FormEvent } from "react";
import { CountryCodePicker } from "../components/CountryCodePicker";
import { PasswordField } from "../components/PasswordField";
import { PasswordStrengthMeter } from "../components/PasswordStrengthMeter";
import { useAuth } from "../context/AuthContext";
import {
  digitsOnly,
  formatPhoneE164,
  getDefaultSelection,
  type PhoneCountrySelection,
} from "../lib/countryPhone";
import { getPhoneFeasibility } from "../lib/phoneValidation";
import {
  validateEmail,
  validateName,
  validatePassword,
  validatePasswordConfirm,
  validatePhone,
} from "../lib/validation";

type Props = {
  onSwitchToLogin: (notice?: string) => void;
};

export function SignupPage({ onSwitchToLogin }: Props) {
  const { signUp, configured } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<PhoneCountrySelection>(getDefaultSelection);
  const [nationalNumber, setNationalNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onCountryChange = (next: PhoneCountrySelection) => {
    setCountry(next);
    setNationalNumber((prev) => digitsOnly(prev).slice(0, next.nationalLength));
  };

  const onNationalChange = (raw: string) => {
    setNationalNumber(digitsOnly(raw).slice(0, country.nationalLength));
  };

  const phoneStatus = useMemo(
    () => getPhoneFeasibility(nationalNumber, country),
    [nationalNumber, country],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const checks = [
      validateName(name),
      validateEmail(email),
      validatePhone(nationalNumber, country),
      validatePassword(password),
      validatePasswordConfirm(password, confirmPassword),
    ];
    const firstError = checks.find(Boolean);
    if (firstError) {
      setError(firstError);
      return;
    }

    const phone = formatPhoneE164(country.dialCode, nationalNumber);

    setSubmitting(true);
    const result = await signUp({
      name,
      email,
      phone,
      password,
    });

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSubmitting(false);
    onSwitchToLogin(
      "Account created. Sign in with your password, or use email/SMS OTP.",
    );
  };

  return (
    <form
      id="auth-panel-signup"
      role="tabpanel"
      aria-labelledby="auth-tab-signup"
      className="auth-form auth-form--signup"
      onSubmit={onSubmit}
      noValidate
    >
      <label>
        <span>Name</span>
        <input
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Priya Sharma"
        />
      </label>

      <label>
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="priya.sharma@gmail.com"
        />
      </label>

      <div className={`phone-field phone-field--${phoneStatus}`}>
        <span className="phone-field__label">Phone</span>
        <div className="phone-field__row">
          <CountryCodePicker value={country} onChange={onCountryChange} />
          <label className="phone-field__number">
            <span className="sr-only">Phone number</span>
            <input
              type="tel"
              name="phone"
              autoComplete="tel-national"
              inputMode="numeric"
              required
              value={nationalNumber}
              onChange={(e) => onNationalChange(e.target.value)}
              placeholder={country.placeholder}
              maxLength={country.nationalLength}
              aria-invalid={phoneStatus === "invalid"}
            />
          </label>
        </div>
      </div>

      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={setPassword}
        placeholder="At least 8 characters"
        visible={showPassword}
        onToggleVisible={() => setShowPassword((v) => !v)}
      />

      <PasswordStrengthMeter password={password} />

      <label>
        <span>Confirm password</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter password"
        />
      </label>

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable real auth.
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </button>

      <p className="auth-switch">
        Already have an account?{" "}
        <button
          type="button"
          className="link-btn"
          onClick={() => onSwitchToLogin()}
        >
          Sign in
        </button>
      </p>
    </form>
  );
}
