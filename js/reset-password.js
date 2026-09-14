import { supabase, showError } from "./supabaseClient.js";

export function initResetPassword() {
  const form = document.getElementById("reset-form");
  const errEl = document.getElementById("reset-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const password = form.password.value;
    if (password.length < 8) {
      showError(errEl, new Error("Password must be at least 8 characters."));
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      showError(errEl, error);
      return;
    }
    window.location.href = "feed.html";
  });
}
