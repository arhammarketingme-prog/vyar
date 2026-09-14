import { supabase, showError } from "./supabaseClient.js";

// ---- Signup (email + password, with username captured up front) ----
export async function signUp({ email, password, username, displayName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, display_name: displayName },
    },
  });
  if (error) throw error;
  return data;
}

// ---- Login with email + password ----
export async function signInWithPassword({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ---- Mobile OTP login (Supabase phone auth) ----
export async function sendPhoneOtp(phone) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
}

export async function verifyPhoneOtp(phone, token) {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
  return data;
}

// ---- Logout (current device only) ----
export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  window.location.href = "login.html";
}

// ---- Logout from all devices (revokes every session) ----
export async function signOutEverywhere() {
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) throw error;
  window.location.href = "login.html";
}

// ---- Wire up a login form ----
export function bindLoginForm(formEl, errEl) {
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const email = formEl.email.value.trim();
    const password = formEl.password.value;
    try {
      await signInWithPassword({ email, password });

      // If this account has 2FA on, the session is only "aal1" so far —
      // prompt for the 6-digit code before letting them into the app.
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level.nextLevel === "aal2" && level.currentLevel !== level.nextLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const factor = factors.totp[0];
        const code = prompt("Enter the 6-digit code from your authenticator app:");
        const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challengeErr) throw challengeErr;
        const { error: verifyErr } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
        if (verifyErr) throw verifyErr;
      }

      window.location.href = "feed.html";
    } catch (err) {
      showError(errEl, err);
    }
  });
}

// ---- Wire up a signup form ----
export function bindSignupForm(formEl, errEl) {
  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const email = formEl.email.value.trim();
    const password = formEl.password.value;
    const username = formEl.username.value.trim().toLowerCase();
    const displayName = formEl.displayName.value.trim();
    try {
      await signUp({ email, password, username, displayName });
      // Supabase sends a confirmation email by default; adjust in project settings.
      errEl.classList.remove("hidden");
      errEl.style.color = "#4ade80";
      errEl.textContent = "Account created. Check your email to confirm, then log in.";
    } catch (err) {
      showError(errEl, err);
    }
  });
}
