# VYRA — Phase 1

Indian-first visual social platform. This is **Phase 1 only**: auth, profiles,
follow graph, photo posts, likes, comments, saves, basic chronological feed.
Everything else in the master spec (Reels, Stories, Explore/Search, Creator
Studio, Advertising Engine, Commerce, Communities, AI layer, Admin panel) is
intentionally **not** in this drop — see "What's next" below.

## Stack

- **Database/Auth/Storage:** Supabase (Postgres + Auth + Storage)
- **Frontend:** Plain HTML/CSS/JS (ES modules), no build step — deploys as-is
  to GitHub Pages, Netlify, Cloudflare Pages, or any static host.

No framework, no bundler. This matches a "near-zero infra cost" MVP: the only
paid thing is your Supabase project (free tier covers early usage).

## Setup

### 1. Create a Supabase project
Go to supabase.com → New project. Note your **Project URL** and **anon public
key** (Settings → API).

### 2. Run the database migration
In the Supabase SQL Editor, run `database/vyra_full.sql` — one file, contains
everything (schema, RLS policies, storage buckets). It's fully idempotent:
safe to run the whole file again any time there's an update, with no
"already exists" errors.

### 3. Configure auth
In Supabase → Authentication → Providers:
- Email/Password: on by default.
- Phone (OTP): enable and connect an SMS provider (e.g. Twilio, MSG91) if you
  want mobile-number login — `sendPhoneOtp` / `verifyPhoneOtp` in `js/auth.js`
  are already wired for this once a provider is configured.
- Turn off "Confirm email" in dev if you want instant login after signup.

### 4. Point the site at your project
Edit `js/supabaseClient.js`:
```js
const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```
The anon key is safe to ship in frontend code — it only has the permissions
your RLS policies grant it. **Never** put a service-role key here.

### 5. Deploy
Upload everything at the root of this folder (`index.html`, `pages/`, `js/`,
`css/`, `database/`, `README.md`) to a GitHub repo, then turn on GitHub Pages
(Settings → Pages → Source: main branch, / root). There is no `frontend`
subfolder — every page lives directly under `pages/`, so uploads are a
single drag-and-drop of everything in this folder, and updates just
overwrite the same paths (no need to delete anything first).

To test locally instead: any static server works, e.g. `python -m http.server
8080` from this folder, then open `http://localhost:8080`.

## What's implemented (Phase 1 + Phase 2)

**Phase 1:**
- Signup / login (email+password; phone OTP wired, needs SMS provider)
- Logout (current device / all devices via `signOutEverywhere`)
- Profile: view, edit-in-place fields, follow/unfollow, followers/following counts
- Privacy: private accounts hide posts/profile from non-followers (enforced by
  RLS via `can_view_profile`, not just hidden in the UI)
- Photo posts: multi-image upload, caption, #hashtag extraction
- Feed: reverse-chronological, infinite scroll, like/save/comment
- Comments: flat list, add comment (threaded replies via `parent_comment_id`
  column exist in schema, UI for nesting not built yet)

**Phase 2:**
- Reels: post a single video (toggle on the create page), full-screen
  vertical swipe feed at `/pages/reels.html` with scroll-snap autoplay
- Story editor: a canvas-based editor at `/pages/create-story.html` with
  **Text** (tap to add, tap the canvas to reposition), **Stickers** (emoji,
  same tap-to-place/move), **Filters** (B&W, Sepia, Vivid, Contrast — CSS
  filters applied to an uploaded photo), and **Draw** (freehand, pick a
  color). Everything is flattened onto one canvas and uploaded as a single
  image. **Music is intentionally not included** — licensed music needs a
  paid catalog/rights deal, which isn't set up; adding an unlicensed
  soundtrack would be a real copyright problem, not a technical gap.
- Explore: trending hashtags (real counts, maintained by a DB trigger) +
  a discovery grid of recent posts
- Search: live search across usernames and hashtags (typo-tolerant via
  Postgres trigram indexes)
- Collections: create named collections (private or public), save posts
  into them from the post detail page, browse a collection's grid
- Saved: a page to browse everything you've bookmarked with 🔖

**Phase 3:**
- Creator Studio (`/pages/creator-studio.html`): real aggregated stats (followers,
  posts, reels, total likes/comments/saves) and a top-posts leaderboard —
  every number comes from your actual data, nothing fabricated
- Tips + Earnings ledger: any user can record a ₹ tip to another user from
  their profile; it's logged in `creator_earnings` for the recipient to see
  in Creator Studio. **This is a ledger only — no real payment gateway is
  connected**, so no money actually moves yet. Marking an earning "paid"
  currently has to be done by hand in the Supabase SQL editor, matching a
  real transfer made outside the app (e.g. UPI). Connecting a real gateway
  (Razorpay is the natural fit for India) is future work: it would mean a
  server-side endpoint (Supabase Edge Function) that creates a payment
  order, and a webhook that marks the tip verified once payment clears —
  never trust a client-side "payment succeeded" message alone.
- Tips via UPI (real money, zero backend): a creator adds their UPI ID
  under Edit Profile. When someone taps "Send a tip", VYRA opens a
  standard `upi://pay` deep link with the amount pre-filled — this
  launches the tipper's own UPI app (GPay/PhonePe/Paytm) to send a REAL
  payment directly to the creator's bank account. **VYRA never touches,
  holds, or processes the money** — it only builds the link. Each tip is
  also logged in `tips`/`creator_earnings` as a record of intent (visible
  in Creator Studio), not proof that payment actually completed — there's
  no webhook confirming success, so treat the ledger as "requested",
  not "received". The deep link only opens an app on mobile devices with
  a UPI app installed; on desktop, the fallback message shows the UPI ID
  to pay manually.
- AI captions/hashtags/translation: intentionally **not built yet**. Doing
  this safely needs an AI API key held server-side (a Supabase Edge
  Function), never in frontend code — that's a deliberate next step, not
  an oversight, and can be added once you're ready to set it up.

**Phase 4:**
- Business profiles: toggle "Business account" on Edit Profile, with
  category, opening hours, and contact phone shown on the profile
- Local discovery: Search now has a "Local Businesses" section, matching
  business name, category, or location
- Advertising Engine: any user can Promote one of their own posts
  (`/pages/promote.html`) — objective, budget (₹, recorded intent same as
  tips), target language/location. New campaigns start `pending_review`
  and only appear in feeds once manually flipped to `active` in the
  Supabase SQL editor (`update campaigns set status = 'active' where id = '...'`)
  — this is deliberate moderation-before-publish, not a bug. Once active,
  a sponsored post is injected into the main feed every 5 posts, clearly
  labeled "Sponsored", with real impression logging (once per viewer per
  page load) and click logging wired through Supabase — visible on
  `/pages/ads-dashboard.html` with actual CTR.

**Phase 5:**
- Products (`/pages/products.html`): a business or creator lists products
  with a name, price, optional photo, and a required **external** link to
  buy/order (their own store, WhatsApp catalog, Instagram shop, etc) —
  VYRA never processes checkout or holds inventory.
- Product tagging: when creating a post, you can tag one of your own
  active products. It shows on the post detail page with a "Buy" button.
- Affiliate click tracking: tapping "Buy" logs a real click in
  `affiliate_events` (who clicked, on which post) before opening the
  external link — visible as a per-product click count on the Products
  page. There's no commission payout automation yet; that would build on
  the same UPI/ledger pattern as tips once needed.

**Phase 6:**
- Communities (`/pages/communities.html`): create public/private/invite-only
  communities, join with one click, post into a community from the create
  page (a dropdown lets you choose "My profile" or a community you've
  joined), browse a community's own feed and member count.
- Direct Messages (`/pages/messages.html`, `/pages/chat.html`): lightweight
  1:1 messaging — deliberately not a full inbox/threading system, per the
  original brief. Uses Supabase Realtime, so messages appear instantly
  without refreshing (both people need the chat open to see it live).
  Realtime is enabled on `direct_messages` by the SQL script automatically.
- **Live is not included.** One-to-many live video needs a dedicated
  streaming service (Mux, Agora, LiveKit, etc) — that's a real,
  ongoing infrastructure cost and a separate integration, not something
  a static frontend + Supabase can fake. Flagging this now so it's a
  known gap, not a surprise later.

**Phase 7 (partial — scale/analytics only, no payment gateway yet):**
- Recommended feed: a "Recommended" tab next to "For You" on the main
  feed, ranking the last 100 posts by a real (but simple) heuristic —
  engagement weighted by recency decay, computed in the browser. This is
  **not a machine-learning recommender** — it's an honest scoring formula,
  good enough for a small/medium community. A real ranking service would
  be the next step at larger scale.
- Platform Analytics (`/pages/analytics.html`): real counts across the
  whole platform — users, posts, reels, comments, likes, communities,
  products, campaign status, ad impressions/clicks, total recorded
  creator earnings. Gated to accounts with `is_admin = true`, which has
  to be set by hand:
  `update profiles set is_admin = true where username = 'yourusername';`
  RLS was extended so an admin's counts aren't limited by other users'
  privacy settings — everyone else's privacy is unaffected.
- Real payment gateway (Razorpay) for tips/ads/affiliate: **not built
  yet** — needs a Razorpay account and a secure backend (Supabase Edge
  Function) to create orders and verify payment via webhook. Set this up
  whenever you're ready; it follows the same "needs a real API key held
  server-side" pattern as AI captions.
- CDN/distributed storage: already effectively covered — Supabase
  Storage serves media through a CDN by default, so there's no separate
  work needed here at this scale.

**Instagram-parity pass (notifications, mentions, moderation basics):**
- Notifications (`/pages/notifications.html`, 🔔 on the feed with an unread
  badge): real notifications for likes, comments, follows, follow
  requests, and @mentions — created by database triggers, not client code
  (so they fire correctly no matter which page/device the action happens
  from).
- @mentions: typing `@username` in a caption or comment links to that
  profile and notifies them (only if the username exists). #hashtags in
  captions/comments are also clickable now, linking to a real per-hashtag
  feed at `/pages/hashtag.html`.
- Carousel posts: multi-image posts are now swipeable (they were
  uploaded correctly since Phase 1, but only the first image ever
  rendered — this was a real bug, now fixed in both the feed and the
  post detail page).
- Private accounts: follow now properly goes through a pending
  "Requested" state for private accounts, with a Follow Requests page
  (`/pages/follow-requests.html`) to accept or reject.
- Block / Mute: both now have real buttons on a profile. Blocking hides
  each person's posts and profile from the other at the database level
  (not just the UI). Muting hides someone's posts from your own feed
  without unfollowing or notifying them.
- Report: any post can be reported (spam, harassment, hate speech,
  nudity, violence, impersonation, other) into a `reports` table, visible
  to admins. There's no moderation action UI yet (approve/remove) — that
  would be the natural next step once reports start coming in.
- Delete: you can delete your own posts from the post detail page.

- Installable on mobile (PWA): a manifest, app icons, and a minimal
  service worker are wired in, so phones offer "Add to Home Screen" /
  "Install app" — it opens full-screen like a native app, with its own
  icon, no browser address bar. No offline caching yet (the service
  worker is a placeholder for that); it exists mainly to satisfy
  installability requirements.
- Avatar sizing fix: every avatar image now has explicit width/height
  HTML attributes (not just CSS), so it can't flash at its full original
  size before the stylesheet finishes loading on a slow connection —
  this was a real, reproducible bug on slow networks, not a one-off.

**UX polish pass (a note on intent):** the original brief explicitly said
not to clone Instagram's exact visual design (to keep VYRA's own identity
and avoid copying proprietary UI) — so this pass matches Instagram's
*conventions and interaction patterns* (things any social app user
already expects), not its pixel-level look:
- Relative timestamps ("2h", "3d") on every post and comment, instead of
  no timestamp at all.
- Verified badge (✓): the `is_verified` column existed since Phase 1 but
  was never shown anywhere — now it appears next to a username on posts,
  profiles, and comments wherever it's true.
- Double-tap a post's image to like it, with a brief heart animation —
  now wired on the main feed.
- "View all N comments" under each feed post links straight to the full
  comment thread.
- Comment replies: threaded replies now work end-to-end (the
  `parent_comment_id` column existed in the schema since Phase 1 but had
  no UI) — tap "Reply" under a comment, it pre-fills @username, and
  replies render indented under their parent.

**Original additions (not just copying Instagram — building on what VYRA
already has):**
- Story Highlights: pick any of your own stories (even expired ones — the
  data isn't deleted, just hidden from the 24h feed) and pin them to a
  named highlight shown permanently on your profile
  (`/pages/create-highlight.html`, viewer at `/pages/highlight-view.html`).
  No new story data is duplicated — a highlight just references existing
  stories.
- Story replies go straight into real DMs: instead of a separate
  ephemeral "story reply" system, replying to someone's story sends a
  normal message through the same Realtime chat already built in
  Phase 6 — one messaging system instead of two.

- **Tip Sticker on Stories** — a real differentiator, not an Instagram
  feature copy: Instagram/TikTok can't put a direct bank-transfer button
  in a story without giving Apple/Google a cut, because App Store rules
  treat that as a "digital tip" requiring in-app purchase. VYRA is a
  website, so that rule doesn't apply — a story can carry a genuinely
  tappable "💰 Tip" button. Only shows up if you've set a UPI ID (Edit
  Profile); place it anywhere on the story while creating it. It's stored
  as a position (not baked into the image), so it renders as a real
  button for viewers, opening their UPI app with the amount ready to
  send — same honest ledger + real-payment-happens-outside-VYRA pattern
  as profile tips.

- Interactive story stickers — real Instagram parity, not decoration:
  **📊 Poll** (two options, live vote percentages), **❓ Question** (open
  text box; answers land in the responder's account *and* go straight
  into a real DM to you, same one-messaging-system pattern as story
  replies), **😍 Emoji Slider** (1–5 rating, average shown to you),
  **🧠 Quiz** (multiple choice with a correct answer; viewers get instant
  right/wrong feedback, you see the % who got it right), **⏳ Countdown**
  (a live ticking timer with a "🔔 Remind me" button). One honest caveat:
  "Remind me" only records interest — VYRA has no push-notification
  infrastructure yet, so nobody actually gets pinged when the countdown
  ends. That's a real gap, not a hidden one.

**Master-spec catch-up pass:**
- **Multi-language UI (real, partial coverage):** an i18n framework
  (`js/i18n.js`) with English/Marathi/Hindi dictionaries, a language
  picker on Edit Profile (saved to your account + this browser), and
  translated navigation/labels on the Feed page. This is the real
  mechanism working end-to-end — extending it to every remaining screen
  is just adding more `data-i18n` tags and dictionary entries, following
  the same pattern already in place. It does **not** translate
  user-generated content (captions, bios, comments) — only VYRA's own
  interface text.
- Account recovery: a real "Forgot password" flow
  (`/pages/forgot-password.html` → email link → `/pages/reset-password.html`),
  using Supabase's built-in reset flow.
- Following-only feed tab, alongside For You and Recommended.
- Comment likes (❤️ + count on every comment and reply).
- Restrict: a lighter alternative to block/mute — a restricted person's
  comments become invisible to everyone except themselves and the post
  author, enforced at the database level, and they're never told they've
  been restricted.
- Accessibility: an actual alt-text field when creating a photo post
  (the column existed since Phase 1 but had no input — screen readers
  now get real descriptions where provided).
- Explore: added Suggested Accounts (people you don't yet follow,
  ranked by followers) and Popular Reels, alongside the existing
  trending hashtags and discovery grid.

**Second catch-up batch:**
- **2FA** (`/pages/security.html`): real TOTP two-factor auth using
  Supabase's built-in MFA — no external provider needed. Scan the QR
  code with any authenticator app (Google Authenticator, Authy, etc);
  login then asks for the 6-digit code after your password.
- **DM image attachments**: the 📷 icon in chat lets you send a photo,
  not just text.
- **Admin moderation** (`/pages/admin-moderation.html`, linked from
  Analytics): review reports (mark reviewed/dismissed) and grant or
  revoke the verified ✓ badge by username — both used to require the
  Supabase SQL editor, now have a real UI.

**Third catch-up batch — all three requested, in order:**
- **Account suspend** (Admin Moderation page): toggles `is_suspended`;
  a suspended account's posts/profile become invisible to everyone
  (enforced in the database, same pattern as blocks), and if that person
  is already logged in, their very next page load signs them out with a
  clear message — no separate "ban" mechanism needed on top of this.
- **Wider multi-language coverage**: the i18n mechanism from before now
  covers headers and buttons on Explore, Communities, Messages,
  Notifications, Collections, Saved, Creator Studio, Products, Search
  (placeholder text), and the Profile page's stats/buttons (Edit
  profile, Saved, Follow/Following, Message, Log out, Posts/Followers/
  Following counts). Still not covered: dynamic per-item text
  (captions, individual post actions, form field labels on pages not
  listed above) — same `data-i18n` pattern extends there too, just not
  done yet everywhere.
- **Google / Facebook login**: the buttons and code are live on the
  login page (`signInWithOAuth`) — but **this needs one-time setup you
  have to do yourself**, since it requires creating an app in each
  provider's own developer console:
  1. Google: console.cloud.google.com → create an OAuth 2.0 Client ID
     (type: Web application).
  2. Facebook: developers.facebook.com → create an app → add "Facebook
     Login" product.
  3. For both: the redirect URI they need is shown in Supabase →
     Authentication → Providers → (Google/Facebook) → it looks like
     `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.
  4. Paste the Client ID/Secret from each provider into that same
     Supabase Providers screen and toggle it on.
  Until that's done, tapping the buttons shows an error from Supabase —
  expected, not a bug in this code. Happy to walk through the console
  steps together whenever you're ready to do it.

**Still genuinely missing** (small remaining list): comment
pinning/sorting, community events, rate limiting, audit logs, malware
scanning on uploads, and adaptive video streaming — each needs either a
paid third-party service or meaningfully more infrastructure than this
Supabase+static-site setup provides.

## What's next

- AI captions/hashtags/translation via a secure Edge Function
- Real payment gateway (Razorpay) for tips, ads, and affiliate payouts
- Live streaming via a dedicated provider (Mux, Agora, LiveKit)
- Deeper ecosystem integration with Nexus/Weavo/AllERP (API contracts,
  shared identity) once those projects are ready for it

## Security notes for this drop

- All tables have RLS enabled — nothing is readable/writable by default.
- Private-account gating happens in Postgres (`can_view_profile`), not just
  hidden in the UI — a determined user hitting the API directly still can't
  see private content they're not allowed to see.
- Storage buckets are public-read in Phase 1 for simplicity. If you need
  private-account posts to also be unguessable in storage, move to Supabase
  signed URLs before going further than an MVP — flagging this now so it's
  not a surprise later.
