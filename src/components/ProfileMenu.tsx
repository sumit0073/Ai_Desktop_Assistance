import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

type Props = {
  /** Corner placement on the Start screen (same profile menu, user initial). */
  placement?: "default" | "corner";
  className?: string;
};

function userInitial(
  fullName: string | undefined,
  email: string | undefined,
): string {
  const fromName = fullName?.trim().split(/\s+/)[0]?.[0];
  if (fromName) return fromName.toUpperCase();
  const fromEmail = email?.trim()?.[0];
  if (fromEmail) return fromEmail.toUpperCase();
  return "?";
}

export function ProfileMenu({
  placement = "default",
  className = "",
}: Props) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const initial = userInitial(
    user.user_metadata?.full_name as string | undefined,
    user.email,
  );
  const isCorner = placement === "corner";

  return (
    <div
      ref={rootRef}
      className={`profile-menu${isCorner ? " profile-menu--corner" : ""}${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        className={isCorner ? "profile-menu__brand" : "profile-menu__avatar"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Open profile menu"
      >
        {initial}
      </button>
      {open && (
        <div className="profile-menu__dropdown">
          <p className="profile-menu__email">{user.email}</p>
          <button
            type="button"
            className="profile-menu__signout"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
