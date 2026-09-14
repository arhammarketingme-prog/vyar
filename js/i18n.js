// VYRA i18n — a small, honest multi-language layer. It translates the
// strings tagged with data-i18n in the HTML (navigation, common buttons,
// headers). It is NOT a machine-translation service and does not
// translate user-generated content (captions, comments, bios) — only
// VYRA's own interface text. Extend the dictionaries below to cover
// more screens over time; the mechanism already works everywhere a
// data-i18n attribute is added.

const DICTIONARY = {
  en: {
    nav_home: "Home",
    nav_search: "Search",
    nav_create: "Create",
    nav_profile: "Profile",
    app_name: "VYRA",
    reels: "Reels",
    collections: "Collections",
    communities: "Communities",
    messages: "Messages",
    for_you: "For You",
    recommended: "Recommended",
    following: "Following",
    your_story: "Your story",
    edit_profile: "Edit profile",
    saved: "Saved",
    creator_studio: "Creator Studio",
    ads: "Ads",
    products: "Products",
    analytics: "Analytics",
    log_out: "Log out",
    follow: "Follow",
    unfollow: "Following",
    message_btn: "Message",
    posts: "Posts",
    followers: "Followers",
    following_count: "Following",
    search_placeholder: "Search users or #hashtags",
    write_caption: "Write a caption... use #hashtags",
    share: "Share",
    post_story: "Post Story",
    notifications: "Notifications",
    explore: "Explore",
  },
  mr: {
    nav_home: "मुख्यपृष्ठ",
    nav_search: "शोध",
    nav_create: "तयार करा",
    nav_profile: "प्रोफाईल",
    app_name: "VYRA",
    reels: "रील्स",
    collections: "कलेक्शन्स",
    communities: "समुदाय",
    messages: "मेसेजेस",
    for_you: "तुमच्यासाठी",
    recommended: "शिफारस केलेलं",
    following: "फॉलो करत आहात",
    your_story: "तुमची स्टोरी",
    edit_profile: "प्रोफाईल संपादित करा",
    saved: "सेव्ह केलेलं",
    creator_studio: "क्रिएटर स्टुडिओ",
    ads: "जाहिराती",
    products: "उत्पादने",
    analytics: "विश्लेषण",
    log_out: "लॉग आउट",
    follow: "फॉलो करा",
    unfollow: "फॉलो करत आहात",
    message_btn: "मेसेज",
    posts: "पोस्ट्स",
    followers: "फॉलोअर्स",
    following_count: "फॉलोइंग",
    search_placeholder: "युजर्स किंवा #हॅशटॅग शोधा",
    write_caption: "कॅप्शन लिहा... #हॅशटॅग वापरा",
    share: "शेअर करा",
    post_story: "स्टोरी पोस्ट करा",
    notifications: "सूचना",
    explore: "एक्सप्लोर",
  },
  hi: {
    nav_home: "होम",
    nav_search: "खोजें",
    nav_create: "बनाएं",
    nav_profile: "प्रोफ़ाइल",
    app_name: "VYRA",
    reels: "रील्स",
    collections: "कलेक्शन",
    communities: "समुदाय",
    messages: "संदेश",
    for_you: "आपके लिए",
    recommended: "अनुशंसित",
    following: "फॉलो कर रहे हैं",
    your_story: "आपकी स्टोरी",
    edit_profile: "प्रोफ़ाइल संपादित करें",
    saved: "सेव किया गया",
    creator_studio: "क्रिएटर स्टूडियो",
    ads: "विज्ञापन",
    products: "उत्पाद",
    analytics: "विश्लेषण",
    log_out: "लॉग आउट",
    follow: "फॉलो करें",
    unfollow: "फॉलो कर रहे हैं",
    message_btn: "संदेश",
    posts: "पोस्ट",
    followers: "फॉलोअर्स",
    following_count: "फॉलोइंग",
    search_placeholder: "यूज़र या #हैशटैग खोजें",
    write_caption: "कैप्शन लिखें... #हैशटैग का उपयोग करें",
    share: "शेयर करें",
    post_story: "स्टोरी पोस्ट करें",
    notifications: "सूचनाएं",
    explore: "एक्सप्लोर",
  },
};

export function getLang() {
  return localStorage.getItem("vyra_lang") || "en";
}

export function setLang(lang) {
  localStorage.setItem("vyra_lang", lang);
}

export function t(key) {
  const lang = getLang();
  return (DICTIONARY[lang] && DICTIONARY[lang][key]) || DICTIONARY.en[key] || key;
}

// Translates every element with a data-i18n="key" attribute on the page.
// Call this once after the page's static HTML is in place.
export function translatePage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
