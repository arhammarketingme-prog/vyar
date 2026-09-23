import { supabase, requireAuth, showError } from "./supabaseClient.js";
import { getLang, setLang } from "./i18n.js";

export async function initEditProfile() {
  const session = await requireAuth();
  if (!session) return;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, bio, website, location, upi_id, is_private, account_type, business_category, business_hours, contact_phone, avatar_url, preferred_language, latitude, longitude, location_updated_at")
    .eq("id", session.user.id)
    .single();

  if (error || !profile) return;

  document.getElementById("language-select").value = profile.preferred_language || getLang();

  const locStatus = document.getElementById("location-status");
  if (profile.latitude != null && profile.longitude != null) {
    locStatus.textContent = "✅ Location shared — you'll show up in \"Nearby\".";
  }
  document.getElementById("share-location-btn").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      locStatus.textContent = "Your browser doesn't support location sharing.";
      return;
    }
    locStatus.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { error: locErr } = await supabase
          .from("profiles")
          .update({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            location_updated_at: new Date().toISOString(),
          })
          .eq("id", session.user.id);
        locStatus.textContent = locErr
          ? "Couldn't save your location — please try again."
          : "✅ Location shared — you'll show up in \"Nearby\".";
      },
      () => { locStatus.textContent = "Location permission denied."; },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });

  const form = document.getElementById("edit-profile-form");
  const avatarInput = document.getElementById("avatar-input");
  const avatarPreview = document.getElementById("avatar-preview");

  if (profile.avatar_url) {
    avatarPreview.src = profile.avatar_url;
    avatarPreview.style.display = "block";
  }

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files[0];
    if (!file) return;
    avatarPreview.src = URL.createObjectURL(file);
    avatarPreview.style.display = "block";
  });

  form.display_name.value = profile.display_name || "";
  form.bio.value = profile.bio || "";
  form.website.value = profile.website || "";
  form.location.value = profile.location || "";
  form.upi_id.value = profile.upi_id || "";
  form.is_private.checked = profile.is_private;
  form.is_business.checked = profile.account_type === "business";
  form.business_category.value = profile.business_category || "";
  form.business_hours.value = profile.business_hours || "";
  form.contact_phone.value = profile.contact_phone || "";

  const errEl = document.getElementById("edit-profile-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");

    let avatarUrl = profile.avatar_url;
    const avatarFile = avatarInput.files[0];
    const selectedLang = document.getElementById("language-select").value;
    if (avatarFile) {
      const ext = avatarFile.name.split(".").pop();
      const path = `${session.user.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
      if (uploadErr) {
        showError(errEl, uploadErr);
        return;
      }
      avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        display_name: form.display_name.value.trim(),
        bio: form.bio.value.trim(),
        website: form.website.value.trim(),
        location: form.location.value.trim(),
        upi_id: form.upi_id.value.trim() || null,
        is_private: form.is_private.checked,
        account_type: form.is_business.checked ? "business" : "personal",
        business_category: form.business_category.value.trim() || null,
        business_hours: form.business_hours.value.trim() || null,
        contact_phone: form.contact_phone.value.trim() || null,
        avatar_url: avatarUrl,
        preferred_language: selectedLang,
      })
      .eq("id", session.user.id);

    if (updateErr) {
      showError(errEl, updateErr);
      return;
    }
    setLang(selectedLang);
    window.location.href = "profile.html";
  });
}
