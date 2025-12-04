// src/pages/AuthPage.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

const INTERNAL_PASSWORD = "pin-login-123"; // >= 6 chars

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [isSignup, setIsSignup] = useState(false); // false = login by code
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);

    try {
      if (isSignup) {
        if (!email || !nickname || code.length !== 4) {
          setError("Fill all fields and use a 4 digit code");
          return;
        }

        // 1) sign up auth user with fixed internal password
        const { error: signErr } = await supabase.auth.signUp({
          email,
          password: INTERNAL_PASSWORD,
        });
        if (signErr) {
          setError(signErr.message);
          return;
        }

        // 2) get user id
        const { data: userData, error: userErr } =
          await supabase.auth.getUser();
        if (userErr || !userData.user) {
          setError("Could not load user after signup");
          return;
        }
        const user = userData.user;

        // 3) upsert profile with 4‑digit code
        const { error: profErr } = await supabase
          .from("profiles")
          .upsert(
            {
              id: user.id,
              username: email,
              nickname,
              code,
            },
            { onConflict: "id" }
          );
        if (profErr) {
          setError(profErr.message);
          return;
        }
      } else {
        // LOGIN with 4‑digit code
        if (code.length !== 4) {
          setError("Enter your 4 digit code");
          return;
        }

        // lookup profile by code
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("id, username")
          .eq("code", code)
          .single();

        if (profErr || !prof) {
          setError("Invalid code");
          return;
        }

        // sign in using stored email + internal password
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: prof.username,
          password: INTERNAL_PASSWORD,
        });

        if (signErr) {
          setError(signErr.message || "Login failed for this code");
          return;
        }
      }

      navigate("/chat");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1>{isSignup ? "Register" : "Enter your code"}</h1>

        {isSignup ? (
          <>
            <input
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              placeholder="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 digit login code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
              }
              required
            />
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Sign up"}
            </button>
            <p className="small">
              Already have an account?{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setIsSignup(false);
                  setError("");
                  setCode("");
                }}
              >
                Login with code
              </button>
            </p>
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 digit code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
              }
            />
            {error && <div className="error">{error}</div>}
            <button type="submit" style={{ display: "none" }}>
              hidden submit
            </button>
            <p className="small">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setIsSignup(true);
                  setError("");
                  setEmail("");
                  setNickname("");
                  setCode("");
                }}
              >
                Register
              </button>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
