import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { WorkSessionProvider } from "./context/WorkSessionContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <WorkSessionProvider>
          <App />
        </WorkSessionProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
