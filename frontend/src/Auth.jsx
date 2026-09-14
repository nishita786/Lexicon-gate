import { useEffect, useState } from "react";
import { api } from "./api";

const INTRO_KEY = "lexiconIntroSeen";
const BEATS = ["Find papers", "Library", "Ask with citations"];

function introAlreadySeen() {
  try {
    return sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return true;
  }
}

function markIntroSeen() {
  try {
    sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    /* private mode */
  }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Logo({ size = "nav" }) {
  return (
    <div className={`logo logo-${size}`} role="img" aria-label="Lexicon Gate">
      <span className="logo-mark" aria-hidden="true">
        <span className="gate-lintel" />
        <span className="gate-post" />
        <span className="gate-post" />
      </span>
      <span className="logo-word">
        <span className="logo-lexicon">Lexicon</span>
        <span className="logo-gate">Gate</span>
      </span>
    </div>
  );
}

export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showIntro, setShowIntro] = useState(() => !introAlreadySeen());
  const [reduced] = useState(prefersReducedMotion);

  const isSignup = mode === "signup";

  function finishIntro() {
    markIntroSeen();
    setShowIntro(false);
  }

  useEffect(() => {
    if (!showIntro) return undefined;
    function onKey(event) {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finishIntro();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIntro]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const user = isSignup
        ? await api.signup({ email, password, name })
        : await api.login({ email, password });
      onSignedIn(user);
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-orbs" aria-hidden="true">
        <span className="orb orb-violet" />
        <span className="orb orb-magenta" />
        <span className="orb orb-orange" />
      </div>
      {showIntro && (
        <div className={`intro-stage${reduced ? " is-reduced" : ""}`}>
          <Logo size="hero" />
          <p className="intro-tagline">Question, evidence, verified answer.</p>
          <ol className="intro-beats">
            {BEATS.map((beat) => (
              <li key={beat} className="intro-beat">
                {beat}
              </li>
            ))}
          </ol>
          <button type="button" className="primary intro-continue" onClick={finishIntro}>
            Continue
          </button>
        </div>
      )}
      <div
        className={`auth-card ${isSignup ? "is-signup" : "is-login"}${showIntro ? " is-behind" : ""}`}
        aria-hidden={showIntro}
      >
        <Logo size="hero" />
        <p className="muted auth-lead">
          {isSignup ? "Create an account to use your library." : "Log in to continue."}
        </p>
        <form className="auth-form" onSubmit={submit}>
          <div className={`fold ${isSignup ? "open" : ""}`}>
            <div className="fold-inner">
              <label>
                Name
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                  tabIndex={isSignup && !showIntro ? 0 : -1}
                />
              </label>
            </div>
          </div>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              tabIndex={showIntro ? -1 : 0}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              tabIndex={showIntro ? -1 : 0}
            />
          </label>
          <div className={`fold ${isSignup ? "open" : ""}`}>
            <div className="fold-inner">
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required={isSignup}
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  tabIndex={isSignup && !showIntro ? 0 : -1}
                />
              </label>
            </div>
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className={`primary${busy ? " is-busy" : ""}`} type="submit" disabled={busy || showIntro}>
            {busy ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
          </button>
        </form>
        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <button
            type="button"
            className="linkish"
            tabIndex={showIntro ? -1 : 0}
            onClick={() => {
              setError("");
              setMode(isSignup ? "login" : "signup");
            }}
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
