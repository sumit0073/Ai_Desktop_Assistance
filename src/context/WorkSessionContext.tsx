import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { endAppSession, startAppSession } from "../lib/appSessions";
import { useAuth } from "./AuthContext";

type WorkSessionContextValue = {
  active: boolean;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
};

const WorkSessionContext = createContext<WorkSessionContextValue | null>(null);

export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!user) setActive(false);
  }, [user]);

  const startSession = useCallback(async () => {
    if (!user) return;
    await startAppSession(user.id);
    setActive(true);
  }, [user]);

  const stopSession = useCallback(async () => {
    await endAppSession();
    // Return to the Start screen — do not hide/close the window.
    setActive(false);
  }, []);

  return (
    <WorkSessionContext.Provider value={{ active, startSession, stopSession }}>
      {children}
    </WorkSessionContext.Provider>
  );
}

export function useWorkSession() {
  const ctx = useContext(WorkSessionContext);
  if (!ctx) {
    throw new Error("useWorkSession must be used within WorkSessionProvider");
  }
  return ctx;
}
