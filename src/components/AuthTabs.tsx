type AuthView = "login" | "signup";

type Props = {
  active: AuthView;
  onChange: (view: AuthView) => void;
};

export function AuthTabs({ active, onChange }: Props) {
  return (
    <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
      <button
        type="button"
        role="tab"
        id="auth-tab-login"
        aria-controls="auth-panel-login"
        aria-selected={active === "login"}
        className={`auth-tabs__btn ${active === "login" ? "is-active" : ""}`}
        onClick={() => onChange("login")}
      >
        Login
      </button>
      <button
        type="button"
        role="tab"
        id="auth-tab-signup"
        aria-controls="auth-panel-signup"
        aria-selected={active === "signup"}
        className={`auth-tabs__btn ${active === "signup" ? "is-active" : ""}`}
        onClick={() => onChange("signup")}
      >
        Sign up
      </button>
      <span
        className={`auth-tabs__indicator ${active === "signup" ? "to-signup" : ""}`}
        aria-hidden="true"
      />
    </div>
  );
}
