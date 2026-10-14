import { useMemo, useState, type FormEvent } from "react";
import { CountryCodePicker } from "../components/CountryCodePicker";
import { useAuth, type OtpChannel } from "../context/AuthContext";
import {
  digitsOnly,
  formatPhoneE164,
  getDefaultSelection,
  type PhoneCountrySelection,
} from "../lib/countryPhone";
import { getPhoneFeasibility } from "../lib/phoneValidation";
import {
  validateEmail,
  validateOtpCode,
  validatePhone,
} from "../lib/validation";

type Props = {
  onBackToLogin: () => void;
};

type Step = "request" | "verify";

export function OtpLoginPage({ onBackToLogin }: Props) {
  const { sendOtp, verifyOtp, configured } = useAuth();
  const [channel, setChannel] = useState<OtpChannel>("email");
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<PhoneCountrySelection>(getDefaultSelection);
  const [nationalNumber, setNationalNumber] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const phoneStatus = useMemo(
    () => getPhoneFeasibility(nationalNumber, country),
    [nationalNumber, country],
  );

  const phoneE164 = formatPhoneE164(country.dialCode, nationalNumber);

  const onCountryChange = (next: PhoneCountrySelection) => {
    setCountry(next);
    setNationalNumber((prev) => digitsOnly(prev).slice(0, next.nationalLength));
  };

  const switchChannel = (next: OtpChannel) => {
    if (next === channel) return;
    setChannel(next);
    setStep("request");
    setToken("");
    setError(null);
    setNotice(null);
  };

  const onRequestCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (channel === "email") {
      const emailError = validateEmail(email);
      if (emailError) {
        setError(emailError);
        return;
      }
    } else {
      const phoneError = validatePhone(nationalNumber, country);
      if (phoneError) {
        setError(phoneError);
        return;
      }
    }

    setSubmitting(true);
    const result =
      channel === "email"
        ? await sendOtp({ channel: "email", email })
        : await sendOtp({ channel: "sms", phone: phoneE164 });
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setStep("verify");
    setNotice(
      channel === "email"
        ? "We sent a 6-digit code to your email."
        : "We sent a 6-digit code by SMS.",
    );
  };

  const onVerifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const codeError = validateOtpCode(token);
    if (codeError) {
      setError(codeError);
      return;
    }

    setSubmitting(true);
    const result =
      channel === "email"
        ? await verifyOtp({ channel: "email", email, token })
        : await verifyOtp({ channel: "sms", phone: phoneE164, token });
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
    }
  };

  const onResend = async () => {
    setError(null);
    setSubmitting(true);
    const result =
      channel === "email"
        ? await sendOtp({ channel: "email", email })
        : await sendOtp({ channel: "sms", phone: phoneE164 });
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setNotice(
      channel === "email"
        ? "New code sent. Check your email."
        : "New code sent. Check your SMS.",
    );
  };

  return (
    <form
      id="auth-panel-otp"
      className="auth-form"
      onSubmit={step === "request" ? onRequestCode : onVerifyCode}
      noValidate
    >
      <div className="otp-channel" role="tablist" aria-label="OTP channel">
        <button
          type="button"
          role="tab"
          aria-selected={channel === "email"}
          className={`otp-channel__btn ${channel === "email" ? "is-active" : ""}`}
          onClick={() => switchChannel("email")}
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={channel === "sms"}
          className={`otp-channel__btn ${channel === "sms" ? "is-active" : ""}`}
          onClick={() => switchChannel("sms")}
        >
          SMS
        </button>
      </div>

      {step === "request" && channel === "email" && (
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
      )}

      {step === "request" && channel === "sms" && (
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
                onChange={(e) =>
                  setNationalNumber(
                    digitsOnly(e.target.value).slice(0, country.nationalLength),
                  )
                }
                placeholder={country.placeholder}
                maxLength={country.nationalLength}
                aria-invalid={phoneStatus === "invalid"}
              />
            </label>
          </div>
        </div>
      )}

      {step === "verify" && (
        <>
          <p className="auth-hint">
            {channel === "email"
              ? `Code sent to ${email}`
              : `Code sent to ${phoneE164}`}
          </p>
          <label>
            <span>One-time code</span>
            <input
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={token}
              onChange={(e) => setToken(digitsOnly(e.target.value).slice(0, 6))}
              placeholder="6-digit code"
            />
          </label>
        </>
      )}

      {!configured && (
        <p className="auth-hint">
          Connect Supabase in <code>.env</code> to enable OTP sign-in.
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting
          ? step === "request"
            ? "Sending…"
            : "Verifying…"
          : step === "request"
            ? "Send code"
            : "Verify and sign in"}
      </button>

      {step === "verify" && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={submitting}
          onClick={() => void onResend()}
        >
          Resend code
        </button>
      )}

      <p className="auth-switch">
        <button type="button" className="link-btn" onClick={onBackToLogin}>
          Back to password sign-in
        </button>
      </p>
    </form>
  );
}
