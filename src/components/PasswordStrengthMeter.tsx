import { getPasswordStrength } from "../lib/passwordStrength";

type Props = {
  password: string;
};

export function PasswordStrengthMeter({ password }: Props) {
  const { score, label } = getPasswordStrength(password);

  return (
    <div
      className={`password-meter score-${score}`}
      role="status"
      aria-live="polite"
      aria-label={`Password strength: ${label}`}
    >
      <div className="password-meter__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`password-meter__bar ${score >= step ? "is-filled" : ""}`}
          />
        ))}
      </div>
      <span className="password-meter__label">{label}</span>
    </div>
  );
}
