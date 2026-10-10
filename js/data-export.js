import { supabase } from "./supabaseClient.js";

// Collects everything that belongs to the logged-in user into one JSON
// file and downloads it. Runs entirely with the user's own session, so
// the database's existing row-level security already guarantees they only
// ever get their own data — no special server access needed.
export async function exportMyData(userId, onStatus) {
  const say = (t) => onStatus && onStatus(t);

  const grab = async (label, query) => {
    say(`Collecting ${label}…`);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return data || [];
  };

  const result = {
    exported_at: new Date().toISOString(),
    note: "Your own data from VYRA. Other people's private content is never included.",
    profile: await grab("profile", supabase.from("profiles").select("*").eq("id", userId)),
    posts: await grab("posts", supabase.from("posts").select("*, post_media(*)").eq("author_id", userId)),
    comments: await grab("comments", supabase.from("comments").select("*").eq("author_id", userId)),
    likes_given: await grab("likes", supabase.from("likes").select("post_id, created_at").eq("user_id", userId)),
    saves: await grab("saves", supabase.from("saves").select("*").eq("user_id", userId)),
    following: await grab("following", supabase.from("follows").select("following_id, status, created_at").eq("follower_id", userId)),
    followers: await grab("followers", supabase.from("follows").select("follower_id, status, created_at").eq("following_id", userId)),
    close_friends: await grab("close friends", supabase.from("close_friends").select("friend_id, created_at").eq("owner_id", userId)),
    collections: await grab("collections", supabase.from("collections").select("*, collection_items(*)").eq("owner_id", userId)),
    stories: await grab("stories", supabase.from("stories").select("*").eq("author_id", userId)),
    messages_sent_and_received: await grab(
      "messages",
      supabase.from("direct_messages").select("*").or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    ),
    feed_preferences: await grab("feed preferences", supabase.from("content_preferences").select("*").eq("user_id", userId)),
  };

  say("Preparing your file…");
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vyra-my-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  say("Done — your file has downloaded.");
}
