import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export function ProfileMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const initial = (user.email?.[0] ?? "A").toUpperCase();

  return (
    <div className="profile-menu">
      <button
        type="button"
        className="profile-menu__avatar"
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
