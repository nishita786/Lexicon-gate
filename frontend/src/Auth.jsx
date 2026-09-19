import { useEffect, useState } from "react";
import { api } from "./api";

const BEATS = [
  { title: "Find papers", detail: "Search across your sources with intent, not keywords alone." },
  { title: "Keep a library", detail: "Save what matters so evidence stays close to the work." },
  { title: "Ask with citations", detail: "Get answers grounded in documents you can verify." },
];

/** Brand hold → beats → unlock continue (ms). Skippable anytime. */
const INTRO_TIMING = {
  brandHold: 1800,
  beatGap: 1600,
  readyHold: 900,
};

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
  const [showIntro, setShowIntro] = useState(true);
  const [reduced] = useState(prefersReducedMotion);
  const [beatIndex, setBeatIndex] = useState(reduced ? BEATS.length : -1);
  const [introReady, setIntroReady] = useState(Boolean(reduced));
  const [leaving, setLeaving] = useState(false);

  const isSignup = mode === "signup";

  function finishIntro() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => setShowIntro(false), reduced ? 0 : 420);
  }

  useEffect(() => {
    if (!showIntro || reduced) return undefined;

    const timers = [];
    let elapsed = INTRO_TIMING.brandHold;

    BEATS.forEach((_, index) => {
      timers.push(
        window.setTimeout(() => setBeatIndex(index), elapsed)
      );
      elapsed += INTRO_TIMING.beatGap;
    });

    timers.push(
      window.setTimeout(() => {
        setBeatIndex(BEATS.length);
        setIntroReady(true);
      }, elapsed + INTRO_TIMING.readyHold)
    );

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [showIntro, reduced]);

  useEffect(() => {
    if (!showIntro) return undefined;
    function onKey(event) {
      if (event.key === "Enter" && introReady) {
        event.preventDefault();
        finishIntro();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finishIntro();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIntro, introReady, leaving]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isSignup && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await (isSignup
        ? api.signup({ email, password, name })
        : api.login({ email, password }));
      const confirmed = await api.me();
      onSignedIn(confirmed);
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  const activeBeat = beatIndex >= 0 && beatIndex < BEATS.length ? BEATS[beatIndex] : null;
  const progress = Math.min(1, Math.max(0, (beatIndex + 1) / (BEATS.length + 1)));

  return (
    <div className="auth-screen">
      <div className="auth-orbs" aria-hidden="true">
        <span className="shape shape-sphere shape-a is-near" />
        <span className="shape shape-torus shape-c" />
        <span className="shape shape-sphere shape-b is-far" />
        <span className="shape shape-torus shape-d" />
        <span className="shape shape-sphere shape-e" />
      </div>
      {showIntro && (
        <div
          className={`intro-stage${reduced ? " is-reduced" : ""}${leaving ? " is-leaving" : ""}${introReady ? " is-ready" : ""}`}
          role="dialog"
          aria-label="Welcome to Lexicon Gate"
          aria-live="polite"
        >
          <div className="intro-brand">
            <Logo size="hero" />
            <p className="intro-kicker">Evidence-first research</p>
            <p className="intro-tagline">Question, evidence, verified answer.</p>
          </div>

          <div className="intro-story">
            {activeBeat ? (
              <div key={activeBeat.title} className="intro-beat-card">
                <p className="intro-beat-title">{activeBeat.title}</p>
                <p className="intro-beat-detail">{activeBeat.detail}</p>
              </div>
            ) : introReady ? (
              <div className="intro-beat-card is-finale">
                <p className="intro-beat-title">Ready when you are</p>
                <p className="intro-beat-detail">Create an account or log in to open your library.</p>
              </div>
            ) : (
              <div className="intro-beat-card is-placeholder" aria-hidden="true">
                <p className="intro-beat-title">&nbsp;</p>
                <p className="intro-beat-detail">&nbsp;</p>
              </div>
            )}
          </div>

          <div className="intro-progress" aria-hidden="true">
            <span className="intro-progress-bar" style={{ transform: `scaleX(${progress})` }} />
          </div>

          <div className="intro-actions">
            {introReady ? (
              <button type="button" className="primary intro-continue" onClick={finishIntro}>
                Enter Lexicon Gate
              </button>
            ) : (
              <button type="button" className="ghost intro-skip" onClick={finishIntro}>
                Skip intro
              </button>
            )}
          </div>
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
