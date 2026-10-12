type Props = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  visible: boolean;
  onToggleVisible: () => void;
};

export function PasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
  minLength,
  visible,
  onToggleVisible,
}: Props) {
  return (
    <label className="password-field">
      <span>{label}</span>
      <div className="password-field__control">
        <input
          type={visible ? "text" : "password"}
          name={name}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={onToggleVisible}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.1 3.51 3.5 2.1l18.4 18.4-1.4 1.41-3.23-3.23A11.7 11.7 0 0 1 12 19c-5 0-9.27-3.11-11-7a12.5 12.5 0 0 1 4.68-5.36L2.1 3.51zM12 7a5 5 0 0 1 4.9 4.03l-1.56-1.56A3 3 0 0 0 12.5 8.1L12 7zm0-2c5 0 9.27 3.11 11 7a12.6 12.6 0 0 1-3.35 4.36l-1.45-1.45A10.4 10.4 0 0 0 21.1 12 10.4 10.4 0 0 0 12 7.1c-.5 0-1 .04-1.48.1L8.9 5.58A12 12 0 0 1 12 5z"
      />
    </svg>
  );
}
