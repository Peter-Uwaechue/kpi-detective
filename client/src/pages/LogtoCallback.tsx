import { useEffect, useState } from "react";
import { finishLogtoLogin } from "@/lib/logto";
import "./KPIDetective.css";

export default function LogtoCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void finishLogtoLogin()
      .then(() => {
        if (active) window.location.replace("/");
      })
      .catch(() => {
        if (active) {
          setError("We could not complete your sign-in. Please return to KPI Detective and request a new email code.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="kpi-shell kpi-auth-callback" aria-live="polite">
      <section className="kpi-auth-callback-card">
        <p className="eyebrow">KPI Detective</p>
        <h1>{error ? "Sign-in needs another try" : "Completing your sign-in"}</h1>
        <p>{error || "Your email code was accepted. We are securely returning you to your workspace."}</p>
        {error && (
          <a className="kpi-button primary" href="/">
            Return to KPI Detective
          </a>
        )}
      </section>
    </main>
  );
}
