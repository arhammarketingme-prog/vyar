import { supabase, showError } from "./supabaseClient.js";

export function initForgotPassword() {
  const form = document.getElementById("forgot-form");
  const errEl = document.getElementById("forgot-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const email = form.email.value.trim();

    // redirectTo must point at a page that lets the user set a new
    // password once they click the emailed link (Supabase appends a
    // recovery token to the URL automatically).
    const redirectTo = new URL("reset-password.html", window.location.href).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      showError(errEl, error);
      return;
    }
    errEl.classList.remove("hidden");
    errEl.style.color = "#4ade80";
    errEl.textContent = "Check your email for a password reset link.";
  });
}
