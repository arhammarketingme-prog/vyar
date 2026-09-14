import { supabase, requireAuth } from "./supabaseClient.js";

export async function initSecurity() {
  const session = await requireAuth();
  if (!session) return;

  await refreshFactors();

  document.getElementById("enroll-btn").addEventListener("click", startEnroll);
}

async function refreshFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  const status = document.getElementById("mfa-status");
  if (error) {
    status.textContent = "Couldn't load 2FA status.";
    return;
  }

  const verified = (data.totp || []).filter((f) => f.status === "verified");
  if (verified.length > 0) {
    status.innerHTML = `<p>✅ Two-factor authentication is <strong>ON</strong>.</p>`;
    verified.forEach((f) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary";
      btn.textContent = `Remove authenticator (${f.id.slice(0, 8)})`;
      btn.addEventListener("click", async () => {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
        refreshFactors();
      });
      status.appendChild(btn);
    });
    document.getElementById("enroll-section").classList.add("hidden");
  } else {
    status.innerHTML = `<p>⚠️ Two-factor authentication is <strong>OFF</strong>.</p>`;
    document.getElementById("enroll-section").classList.remove("hidden");
  }
}

async function startEnroll() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) {
    alert(error.message);
    return;
  }

  document.getElementById("qr-wrap").innerHTML = `
    <img src="${data.totp.qr_code}" alt="Scan with your authenticator app" style="background:white; padding:8px; border-radius:8px;">
    <p class="muted">Can't scan? Enter this key manually: <code>${data.totp.secret}</code></p>
    <input type="text" id="mfa-code-input" placeholder="6-digit code from your app" maxlength="6">
    <button id="confirm-mfa-btn" class="btn">Confirm</button>
  `;

  document.getElementById("confirm-mfa-btn").addEventListener("click", async () => {
    const code = document.getElementById("mfa-code-input").value.trim();
    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId: data.id });
    if (challengeErr) {
      alert(challengeErr.message);
      return;
    }
    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId: data.id,
      challengeId: challenge.id,
      code,
    });
    if (verifyErr) {
      alert(verifyErr.message);
      return;
    }
    alert("2FA is now on for your account.");
    document.getElementById("qr-wrap").innerHTML = "";
    refreshFactors();
  });
}
