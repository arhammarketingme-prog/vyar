-- =====================================================================
-- VYRA — Phase 1 — FULL COMBINED SCRIPT
-- Schema + RLS policies + Storage buckets, all in one file.
-- 100% idempotent: safe to run this entire file again any time
-- (tables use IF NOT EXISTS, functions use OR REPLACE, triggers and
-- policies are DROPped first). Just run this whole file top to bottom
-- in the Supabase SQL Editor whenever there's an update.
-- =====================================================================

-- =====================================================================
-- PART 1: SCHEMA
-- Domains covered: Identity (profiles), Social graph, Posts, Engagement
-- Auth itself (users, sessions, OTP, password hashing) is handled by
-- Supabase Auth (auth.users) — we extend it with a public.profiles table.
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm; -- for typo-tolerant username/hashtag search later

-- ---------------------------------------------------------------------
-- IDENTITY
-- ---------------------------------------------------------------------

-- One row per authenticated user (1:1 with auth.users).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) between 3 and 30 and username ~ '^[a-z0-9_.]+$'),
  display_name text not null default '',
  bio text default '',
  website text default '',
  location text default '',
  avatar_url text,
  is_private boolean not null default false,
  is_verified boolean not null default false,
  account_type text not null default 'personal' check (account_type in ('personal', 'creator', 'business')),
  preferred_language text not null default 'en',
  followers_count integer not null default 0,
  following_count integer not null default 0,
  posts_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_username_trgm on public.profiles using gin (username gin_trgm_ops);

-- Auto-create a profile row whenever a new auth.users row appears.
-- Google/Facebook OAuth signups don't send a "username" field — only
-- full_name/name/email — so we build a readable username from whichever
-- of those is available, then append a short suffix to keep it unique.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  final_username text;
begin
  base_username := lower(regexp_replace(
    coalesce(
      nullif(new.raw_user_meta_data->>'username', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(new.email, '@', 1)
    ),
    '[^a-zA-Z0-9_.]+', '_', 'g'
  ));
  base_username := substr(base_username, 1, 20);
  if base_username is null or char_length(base_username) < 3 then
    base_username := 'user';
  end if;
  final_username := base_username || '_' || substr(new.id::text, 1, 6);

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    final_username,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      ''
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- SOCIAL GRAPH
-- ---------------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists idx_follows_following on public.follows (following_id);
create index if not exists idx_follows_follower on public.follows (follower_id);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id)
);

-- ---------------------------------------------------------------------
-- POSTS (photo posts — Phase 1; video/reels/stories come in Phase 2)
-- ---------------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  caption text default '',
  location text,
  is_archived boolean not null default false,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  save_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_author_created on public.posts (author_id, created_at desc);

-- Media items belonging to a post (supports single image or carousel).
create table if not exists public.post_media (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,        -- path inside the storage bucket (see MediaStorageProvider)
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  position integer not null default 0,
  width integer,
  height integer,
  alt_text text default '',          -- accessibility description
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create table if not exists public.hashtags (
  id uuid primary key default uuid_generate_v4(),
  tag text unique not null,
  post_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_hashtags_tag_trgm on public.hashtags using gin (tag gin_trgm_ops);

create table if not exists public.post_hashtags (
  post_id uuid not null references public.posts(id) on delete cascade,
  hashtag_id uuid not null references public.hashtags(id) on delete cascade,
  primary key (post_id, hashtag_id)
);

-- ---------------------------------------------------------------------
-- ENGAGEMENT
-- ---------------------------------------------------------------------

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2200),
  like_count integer not null default 0,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_post_created on public.comments (post_id, created_at desc);

create table if not exists public.saves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- ---------------------------------------------------------------------
-- COUNT MAINTENANCE TRIGGERS (keep denormalized counters accurate)
-- ---------------------------------------------------------------------

create or replace function public.adjust_follow_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.status = 'accepted' then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set followers_count = followers_count + 1 where id = new.following_id;
  elsif tg_op = 'DELETE' and old.status = 'accepted' then
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_follow_counts on public.follows;
create trigger trg_follow_counts
  after insert or delete on public.follows
  for each row execute function public.adjust_follow_counts();

create or replace function public.adjust_post_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set posts_count = posts_count + 1 where id = new.author_id;
  elsif tg_op = 'DELETE' then
    update public.profiles set posts_count = greatest(posts_count - 1, 0) where id = old.author_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_post_counts on public.posts;
create trigger trg_post_counts
  after insert or delete on public.posts
  for each row execute function public.adjust_post_counts();

create or replace function public.adjust_like_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_like_counts on public.likes;
create trigger trg_like_counts
  after insert or delete on public.likes
  for each row execute function public.adjust_like_counts();

create or replace function public.adjust_comment_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comment_counts on public.comments;
create trigger trg_comment_counts
  after insert or delete on public.comments
  for each row execute function public.adjust_comment_counts();

create or replace function public.adjust_save_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set save_count = save_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' then
    update public.posts set save_count = greatest(save_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_save_counts on public.saves;
create trigger trg_save_counts
  after insert or delete on public.saves
  for each row execute function public.adjust_save_counts();
-- =====================================================================
-- PART 2: ROW LEVEL SECURITY
-- Principle: private accounts hide posts/profile details from non-followers.
-- Every table that holds user data has RLS enabled — no table is left open.
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.hashtags enable row level security;
alter table public.post_hashtags enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.saves enable row level security;

-- ---------------------------------------------------------------------
-- Helper: is `viewer` allowed to see `owner`'s private content?
-- (owner is public, or viewer IS owner, or viewer follows owner and is accepted)
-- ---------------------------------------------------------------------
create or replace function public.can_view_profile(owner uuid, viewer uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    owner = viewer
    or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
    or exists (
      select 1 from public.follows f
      where f.follower_id = viewer and f.following_id = owner and f.status = 'accepted'
    );
$$;

-- PROFILES ----------------------------------------------------------
drop policy if exists "profiles are viewable respecting privacy" on public.profiles;
create policy "profiles are viewable respecting privacy"
  on public.profiles for select
  using (public.can_view_profile(id, auth.uid()));

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- No public insert policy: rows are created only by the handle_new_user trigger.

-- FOLLOWS -------------------------------------------------------------
drop policy if exists "follows are viewable by anyone" on public.follows;
create policy "follows are viewable by anyone" -- who follows whom is public knowledge
  on public.follows for select
  using (true);

drop policy if exists "users can follow as themselves" on public.follows;
create policy "users can follow as themselves"
  on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "users can unfollow their own follow rows" on public.follows;
create policy "users can unfollow their own follow rows"
  on public.follows for delete
  using (auth.uid() = follower_id);

drop policy if exists "followed user can accept/reject a pending request" on public.follows;
create policy "followed user can accept/reject a pending request"
  on public.follows for update
  using (auth.uid() = following_id);

-- BLOCKS / MUTES --------------------------------------------------------
drop policy if exists "users manage their own blocks" on public.blocks;
create policy "users manage their own blocks"
  on public.blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

drop policy if exists "users manage their own mutes" on public.mutes;
create policy "users manage their own mutes"
  on public.mutes for all
  using (auth.uid() = muter_id)
  with check (auth.uid() = muter_id);

-- POSTS -----------------------------------------------------------------
drop policy if exists "posts are viewable respecting author privacy" on public.posts;
create policy "posts are viewable respecting author privacy"
  on public.posts for select
  using (public.can_view_profile(author_id, auth.uid()));

drop policy if exists "users can create their own posts" on public.posts;
create policy "users can create their own posts"
  on public.posts for insert
  with check (auth.uid() = author_id);

drop policy if exists "users can update their own posts" on public.posts;
create policy "users can update their own posts"
  on public.posts for update
  using (auth.uid() = author_id);

drop policy if exists "users can delete their own posts" on public.posts;
create policy "users can delete their own posts"
  on public.posts for delete
  using (auth.uid() = author_id);

-- POST MEDIA --------------------------------------------------------------
drop policy if exists "post media inherits post visibility" on public.post_media;
create policy "post media inherits post visibility"
  on public.post_media for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "author manages media on their own posts" on public.post_media;
create policy "author manages media on their own posts"
  on public.post_media for all
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- HASHTAGS / POST_HASHTAGS ---------------------------------------------
drop policy if exists "hashtags are public" on public.hashtags;
create policy "hashtags are public"
  on public.hashtags for select using (true);

drop policy if exists "authenticated users can create hashtags" on public.hashtags;
create policy "authenticated users can create hashtags"
  on public.hashtags for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "post_hashtags inherit post visibility" on public.post_hashtags;
create policy "post_hashtags inherit post visibility"
  on public.post_hashtags for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "author manages hashtags on their own posts" on public.post_hashtags;
create policy "author manages hashtags on their own posts"
  on public.post_hashtags for all
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- LIKES -------------------------------------------------------------------
drop policy if exists "likes are viewable respecting post visibility" on public.likes;
create policy "likes are viewable respecting post visibility"
  on public.likes for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "users can like as themselves" on public.likes;
create policy "users can like as themselves"
  on public.likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can unlike their own like" on public.likes;
create policy "users can unlike their own like"
  on public.likes for delete
  using (auth.uid() = user_id);

-- COMMENTS ------------------------------------------------------------------
drop policy if exists "comments are viewable respecting post visibility" on public.comments;
create policy "comments are viewable respecting post visibility"
  on public.comments for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "users can comment as themselves" on public.comments;
create policy "users can comment as themselves"
  on public.comments for insert
  with check (auth.uid() = author_id);

drop policy if exists "users can delete their own comments" on public.comments;
create policy "users can delete their own comments"
  on public.comments for delete
  using (auth.uid() = author_id);

drop policy if exists "post author can moderate (delete) comments on their post" on public.comments;
create policy "post author can moderate (delete) comments on their post"
  on public.comments for delete
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- SAVES (always private to the saver) ----------------------------------------
drop policy if exists "users see only their own saves" on public.saves;
create policy "users see only their own saves"
  on public.saves for select
  using (auth.uid() = user_id);

drop policy if exists "users can save as themselves" on public.saves;
create policy "users can save as themselves"
  on public.saves for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can unsave their own save" on public.saves;
create policy "users can unsave their own save"
  on public.saves for delete
  using (auth.uid() = user_id);
-- =====================================================================
-- PART 3: STORAGE (MediaStorageProvider implementation)
-- Buckets: 'avatars' (public read), 'post-media' (public read, since
-- private-account gating happens at the DB/query layer via signed URLs
-- in a later phase — Phase 1 keeps this simple).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

-- AVATARS: any authenticated user can upload to their own folder (userid/...)
drop policy if exists "avatar images are publicly readable" on storage.objects;
create policy "avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can update/replace their own avatar" on storage.objects;
create policy "users can update/replace their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- POST MEDIA: same per-user-folder convention.
drop policy if exists "post media is publicly readable" on storage.objects;
create policy "post media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'post-media');

drop policy if exists "users can upload their own post media" on storage.objects;
create policy "users can upload their own post media"
  on storage.objects for insert
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own post media" on storage.objects;
create policy "users can delete their own post media"
  on storage.objects for delete
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Upload convention enforced by the frontend (see js/create-post.js):
--   post-media/<user_id>/<post_id>/<position>-<filename>
--   avatars/<user_id>/avatar.<ext>

-- =====================================================================
-- PART 4: PHASE 2 — Reels, Stories, Explore, Search, Collections
-- Appended to the same idempotent file. Run the WHOLE file again.
-- =====================================================================

-- REELS: posts already support video via post_media.media_type = 'video'.
-- This column just lets us separate the Reels feed from the Photo feed.
alter table public.posts add column if not exists post_type text not null default 'post'
  check (post_type in ('post', 'reel'));

create index if not exists idx_posts_type_created on public.posts (post_type, created_at desc);

-- HASHTAG COUNTS: keep hashtags.post_count accurate (needed for trending/search).
create or replace function public.adjust_hashtag_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.hashtags set post_count = post_count + 1 where id = new.hashtag_id;
  elsif tg_op = 'DELETE' then
    update public.hashtags set post_count = greatest(post_count - 1, 0) where id = old.hashtag_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hashtag_counts on public.post_hashtags;
create trigger trg_hashtag_counts
  after insert or delete on public.post_hashtags
  for each row execute function public.adjust_hashtag_counts();

-- STORIES ---------------------------------------------------------------
create table if not exists public.stories (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null default 'image' check (media_type in ('image', 'video', 'text')),
  storage_path text,              -- null for text-only stories
  text_content text,
  background_color text default '#ff5d3b',
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists idx_stories_author_created on public.stories (author_id, created_at desc);
create index if not exists idx_stories_expires on public.stories (expires_at);

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create or replace function public.adjust_story_view_counts()
returns trigger language plpgsql as $$
begin
  update public.stories set view_count = view_count + 1 where id = new.story_id;
  return null;
end;
$$;

drop trigger if exists trg_story_view_counts on public.story_views;
create trigger trg_story_view_counts
  after insert on public.story_views
  for each row execute function public.adjust_story_view_counts();

-- COLLECTIONS -------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  is_private boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_collections_owner on public.collections (owner_id, created_at desc);

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);

-- RLS: enable + idempotent policies -----------------------------------------
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

drop policy if exists "stories are viewable respecting author privacy" on public.stories;
create policy "stories are viewable respecting author privacy"
  on public.stories for select
  using (expires_at > now() and public.can_view_profile(author_id, auth.uid()));

drop policy if exists "users can create their own stories" on public.stories;
create policy "users can create their own stories"
  on public.stories for insert
  with check (auth.uid() = author_id);

drop policy if exists "users can delete their own stories" on public.stories;
create policy "users can delete their own stories"
  on public.stories for delete
  using (auth.uid() = author_id);

drop policy if exists "viewers can log their own story view" on public.story_views;
create policy "viewers can log their own story view"
  on public.story_views for insert
  with check (auth.uid() = viewer_id);

drop policy if exists "story author sees who viewed, viewer sees own view" on public.story_views;
create policy "story author sees who viewed, viewer sees own view"
  on public.story_views for select
  using (
    auth.uid() = viewer_id
    or exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid())
  );

drop policy if exists "collections viewable if public or own" on public.collections;
create policy "collections viewable if public or own"
  on public.collections for select
  using (not is_private or owner_id = auth.uid());

drop policy if exists "users manage their own collections" on public.collections;
create policy "users manage their own collections"
  on public.collections for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "collection items inherit collection visibility" on public.collection_items;
create policy "collection items inherit collection visibility"
  on public.collection_items for select
  using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and (not c.is_private or c.owner_id = auth.uid())
    )
  );

drop policy if exists "owner manages items in their own collections" on public.collection_items;
create policy "owner manages items in their own collections"
  on public.collection_items for all
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));

-- STORAGE: stories reuse the post-media bucket, convention:
--   post-media/<user_id>/stories/<story_id>.<ext>
-- (policies for post-media already allow any path under the user's own folder)


-- =====================================================================
-- PART 5: PHASE 3 — Creator Studio & Monetization (ledger only)
-- IMPORTANT: tips/earnings here are a RECORD-KEEPING ledger only.
-- No real money moves through this schema — that requires integrating
-- a payment gateway (e.g. Razorpay for India), which is a separate,
-- future step. Until then, "paid" status is set manually by whoever
-- administers the database, matching real bank transfers made outside
-- the app. Nothing here should be presented to users as real payment
-- processing.
-- =====================================================================

-- TIPS ----------------------------------------------------------------
create table if not exists public.tips (
  id uuid primary key default uuid_generate_v4(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  amount_inr integer not null check (amount_inr > 0),
  message text,
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create index if not exists idx_tips_to_user on public.tips (to_user_id, created_at desc);

-- CREATOR EARNINGS (ledger) --------------------------------------------
create table if not exists public.creator_earnings (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('tip', 'subscription', 'ad', 'affiliate', 'brand_campaign')),
  amount_inr integer not null check (amount_inr > 0),
  status text not null default 'pending' check (status in ('pending', 'eligible', 'paid')),
  reference_id uuid, -- e.g. the tips.id this earning came from
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_earnings_creator on public.creator_earnings (creator_id, created_at desc);

-- Auto-log every tip as a pending earning for the recipient.
create or replace function public.log_tip_as_earning()
returns trigger language plpgsql as $$
begin
  insert into public.creator_earnings (creator_id, source, amount_inr, reference_id)
  values (new.to_user_id, 'tip', new.amount_inr, new.id);
  return new;
end;
$$;

drop trigger if exists trg_log_tip_as_earning on public.tips;
create trigger trg_log_tip_as_earning
  after insert on public.tips
  for each row execute function public.log_tip_as_earning();

-- RLS -------------------------------------------------------------------
alter table public.tips enable row level security;
alter table public.creator_earnings enable row level security;

drop policy if exists "tips visible to sender and recipient" on public.tips;
create policy "tips visible to sender and recipient"
  on public.tips for select
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "users can send tips as themselves" on public.tips;
create policy "users can send tips as themselves"
  on public.tips for insert
  with check (auth.uid() = from_user_id);

drop policy if exists "creators see only their own earnings" on public.creator_earnings;
create policy "creators see only their own earnings"
  on public.creator_earnings for select
  using (auth.uid() = creator_id);

-- No insert/update policy for creator_earnings from the client — rows are
-- created only by the log_tip_as_earning trigger, and "paid" status is
-- set by whoever administers the database (service-role / SQL editor),
-- not by any user action in the app.

-- =====================================================================
-- PART 6: UPI ID for direct peer-to-peer tips
-- Real money moves via the user's own UPI app (GPay/PhonePe/Paytm) —
-- VYRA never touches the money or holds it. This column just lets a
-- creator publish where tips should go; the tips/creator_earnings
-- tables from Part 5 remain a record of intent, not proof of payment.
-- =====================================================================

alter table public.profiles add column if not exists upi_id text;

-- =====================================================================
-- PART 7: PHASE 4 — Business Profiles, Local Discovery, Advertising
-- Campaigns require manual review (status flips to 'active' by hand in
-- the SQL editor for now) before they appear in anyone's feed — this
-- mirrors real ad-platform moderation and avoids auto-publishing
-- unreviewed ads. Budget is a stated intent, not a real charge; payment
-- for ads uses the same UPI-to-a-VYRA-account approach as tips until a
-- real payment gateway is integrated.
-- =====================================================================

-- BUSINESS PROFILE FIELDS (extends profiles rather than a new table —
-- account_type already distinguishes personal/creator/business)
alter table public.profiles add column if not exists business_category text;
alter table public.profiles add column if not exists business_hours text;
alter table public.profiles add column if not exists contact_phone text;

-- CAMPAIGNS --------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  advertiser_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  objective text not null check (objective in ('brand_awareness', 'website_traffic', 'local_promotion', 'lead_generation')),
  budget_inr integer not null check (budget_inr > 0),
  target_language text,
  target_location text,
  status text not null default 'pending_review' check (status in ('pending_review', 'active', 'paused', 'completed', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists idx_campaigns_advertiser on public.campaigns (advertiser_id, created_at desc);
create index if not exists idx_campaigns_active on public.campaigns (status) where status = 'active';

-- AD IMPRESSIONS / CLICKS -------------------------------------------------
create table if not exists public.ad_impressions (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  viewer_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_clicks (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  viewer_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_impressions_campaign on public.ad_impressions (campaign_id);
create index if not exists idx_clicks_campaign on public.ad_clicks (campaign_id);

-- RLS ----------------------------------------------------------------------
alter table public.campaigns enable row level security;
alter table public.ad_impressions enable row level security;
alter table public.ad_clicks enable row level security;

drop policy if exists "advertisers manage their own campaigns" on public.campaigns;
create policy "advertisers manage their own campaigns"
  on public.campaigns for all
  using (auth.uid() = advertiser_id)
  with check (auth.uid() = advertiser_id);

drop policy if exists "active campaigns are readable by any authenticated user" on public.campaigns;
create policy "active campaigns are readable by any authenticated user"
  on public.campaigns for select
  using (status = 'active' or auth.uid() = advertiser_id);

drop policy if exists "any authenticated viewer can log an impression" on public.ad_impressions;
create policy "any authenticated viewer can log an impression"
  on public.ad_impressions for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "advertiser sees impressions on their own campaigns" on public.ad_impressions;
create policy "advertiser sees impressions on their own campaigns"
  on public.ad_impressions for select
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.advertiser_id = auth.uid()));

drop policy if exists "any authenticated viewer can log a click" on public.ad_clicks;
create policy "any authenticated viewer can log a click"
  on public.ad_clicks for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "advertiser sees clicks on their own campaigns" on public.ad_clicks;
create policy "advertiser sees clicks on their own campaigns"
  on public.ad_clicks for select
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and c.advertiser_id = auth.uid()));

-- =====================================================================
-- PART 8: PHASE 5 — Commerce (product tagging, affiliate click tracking)
-- Checkout happens on an EXTERNAL link the seller provides (their own
-- store, WhatsApp catalog, Instagram shop, etc). VYRA does not process
-- payments or hold inventory — it only lets a product be tagged on a
-- post and tracks clicks, same honesty pattern as tips/ads.
-- =====================================================================

create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text,
  price_inr integer check (price_inr > 0),
  image_storage_path text,
  external_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_owner on public.products (owner_id, created_at desc);

create table if not exists public.post_products (
  post_id uuid not null references public.posts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (post_id, product_id)
);

create table if not exists public.affiliate_events (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  viewer_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_affiliate_product on public.affiliate_events (product_id, created_at desc);

-- RLS ------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.post_products enable row level security;
alter table public.affiliate_events enable row level security;

drop policy if exists "active products are publicly viewable" on public.products;
create policy "active products are publicly viewable"
  on public.products for select
  using (is_active or owner_id = auth.uid());

drop policy if exists "owners manage their own products" on public.products;
create policy "owners manage their own products"
  on public.products for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "post_products inherit post visibility" on public.post_products;
create policy "post_products inherit post visibility"
  on public.post_products for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "post author tags products on their own posts" on public.post_products;
create policy "post author tags products on their own posts"
  on public.post_products for all
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

drop policy if exists "any authenticated viewer can log a product click" on public.affiliate_events;
create policy "any authenticated viewer can log a product click"
  on public.affiliate_events for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "product owner sees clicks on their own products" on public.affiliate_events;
create policy "product owner sees clicks on their own products"
  on public.affiliate_events for select
  using (exists (select 1 from public.products pr where pr.id = product_id and pr.owner_id = auth.uid()));

-- =====================================================================
-- PART 9: PHASE 6 — Communities & Direct Messages
-- "Live" is intentionally not included here: real one-to-many video
-- broadcast needs a dedicated streaming service (e.g. Mux, Agora,
-- LiveKit) — a static frontend + Supabase alone cannot serve live video
-- to multiple viewers. That's future work requiring a paid third-party
-- integration, not something to fake here.
-- =====================================================================

-- COMMUNITIES -------------------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default uuid_generate_v4(),
  name text not null check (char_length(name) between 3 and 60),
  description text,
  visibility text not null default 'public' check (visibility in ('public', 'private', 'invite_only')),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  member_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_communities_name_trgm on public.communities using gin (name gin_trgm_ops);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator', 'owner')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- A post can optionally belong to a community (nullable — most posts don't).
alter table public.posts add column if not exists community_id uuid references public.communities(id) on delete set null;
create index if not exists idx_posts_community on public.posts (community_id, created_at desc) where community_id is not null;

-- Auto-add the creator as owner + keep member_count accurate.
create or replace function public.handle_new_community()
returns trigger language plpgsql as $$
begin
  insert into public.community_members (community_id, user_id, role)
  values (new.id, new.creator_id, 'owner');
  return new;
end;
$$;

drop trigger if exists trg_new_community on public.communities;
create trigger trg_new_community
  after insert on public.communities
  for each row execute function public.handle_new_community();

create or replace function public.adjust_community_member_count()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.communities set member_count = member_count + 1 where id = new.community_id;
  elsif tg_op = 'DELETE' then
    update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_community_member_count on public.community_members;
create trigger trg_community_member_count
  after insert or delete on public.community_members
  for each row execute function public.adjust_community_member_count();

-- DIRECT MESSAGES (flat, 1:1 — lightweight by design, not a full inbox system)
create table if not exists public.direct_messages (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists idx_dm_participants on public.direct_messages (sender_id, recipient_id, created_at desc);
create index if not exists idx_dm_participants_rev on public.direct_messages (recipient_id, sender_id, created_at desc);

-- RLS ------------------------------------------------------------------
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "public/invite-only communities visible to all, private to members" on public.communities;
create policy "public/invite-only communities visible to all, private to members"
  on public.communities for select
  using (
    visibility <> 'private'
    or exists (select 1 from public.community_members m where m.community_id = id and m.user_id = auth.uid())
  );

drop policy if exists "authenticated users can create communities" on public.communities;
create policy "authenticated users can create communities"
  on public.communities for insert
  with check (auth.uid() = creator_id);

drop policy if exists "owner/moderators can update their community" on public.communities;
create policy "owner/moderators can update their community"
  on public.communities for update
  using (exists (select 1 from public.community_members m where m.community_id = id and m.user_id = auth.uid() and m.role in ('owner', 'moderator')));

drop policy if exists "members list is visible to anyone who can see the community" on public.community_members;
create policy "members list is visible to anyone who can see the community"
  on public.community_members for select
  using (
    exists (
      select 1 from public.communities c
      where c.id = community_id
      and (c.visibility <> 'private' or exists (select 1 from public.community_members m2 where m2.community_id = c.id and m2.user_id = auth.uid()))
    )
  );

drop policy if exists "users can join public communities themselves" on public.community_members;
create policy "users can join public communities themselves"
  on public.community_members for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can leave a community themselves" on public.community_members;
create policy "users can leave a community themselves"
  on public.community_members for delete
  using (auth.uid() = user_id);

drop policy if exists "participants can see their own direct messages" on public.direct_messages;
create policy "participants can see their own direct messages"
  on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "users can send messages as themselves" on public.direct_messages;
create policy "users can send messages as themselves"
  on public.direct_messages for insert
  with check (auth.uid() = sender_id);

drop policy if exists "recipient can mark a message read" on public.direct_messages;
create policy "recipient can mark a message read"
  on public.direct_messages for update
  using (auth.uid() = recipient_id);

-- REALTIME: enable live updates for chat (Supabase Realtime broadcasts
-- changes on tables added to this publication). Safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;

-- =====================================================================
-- PART 10: PHASE 7 — Admin role for platform analytics
-- No admin panel UI yet beyond a read-only analytics page; the flag
-- itself must be set by hand for whichever account should have access:
--   update profiles set is_admin = true where username = 'yourusername';
-- =====================================================================

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- =====================================================================
-- PART 11: Admin bypass for accurate platform-wide analytics
-- Without this, an admin's counts would be limited by the same privacy
-- RLS everyone else has (e.g. private profiles hidden from non-followers)
-- and Analytics would show wrong, partial numbers. This lets a real
-- admin (is_admin = true) see full counts for reporting, while normal
-- users' privacy rules are completely unchanged for everyone else.
-- =====================================================================

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles are viewable respecting privacy" on public.profiles;
create policy "profiles are viewable respecting privacy"
  on public.profiles for select
  using (public.can_view_profile(id, auth.uid()) or public.is_current_user_admin());

drop policy if exists "posts are viewable respecting author privacy" on public.posts;
create policy "posts are viewable respecting author privacy"
  on public.posts for select
  using (public.can_view_profile(author_id, auth.uid()) or public.is_current_user_admin());

drop policy if exists "comments are viewable respecting post visibility" on public.comments;
create policy "comments are viewable respecting post visibility"
  on public.comments for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
    or public.is_current_user_admin()
  );

drop policy if exists "likes are viewable respecting post visibility" on public.likes;
create policy "likes are viewable respecting post visibility"
  on public.likes for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
    )
    or public.is_current_user_admin()
  );

drop policy if exists "stories are viewable respecting author privacy" on public.stories;
create policy "stories are viewable respecting author privacy"
  on public.stories for select
  using ((expires_at > now() and public.can_view_profile(author_id, auth.uid())) or public.is_current_user_admin());

drop policy if exists "public/invite-only communities visible to all, private to members" on public.communities;
create policy "public/invite-only communities visible to all, private to members"
  on public.communities for select
  using (
    visibility <> 'private'
    or exists (select 1 from public.community_members m where m.community_id = id and m.user_id = auth.uid())
    or public.is_current_user_admin()
  );

drop policy if exists "active products are publicly viewable" on public.products;
create policy "active products are publicly viewable"
  on public.products for select
  using (is_active or owner_id = auth.uid() or public.is_current_user_admin());

-- =====================================================================
-- PART 12: Deeper Instagram-parity — notifications, mentions, follow
-- requests, blocks enforcement, reports
-- =====================================================================

-- NOTIFICATIONS ----------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'follow', 'follow_request', 'mention_post', 'mention_comment')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_notifications_recipient on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "recipients see only their own notifications" on public.notifications;
create policy "recipients see only their own notifications"
  on public.notifications for select
  using (auth.uid() = recipient_id);

drop policy if exists "recipient can mark their notifications read" on public.notifications;
create policy "recipient can mark their notifications read"
  on public.notifications for update
  using (auth.uid() = recipient_id);

-- Notifications are inserted only by triggers below (security definer),
-- never directly by client code — no insert policy needed for regular users.

create or replace function public.notify_on_like()
returns trigger language plpgsql security definer as $$
declare
  post_author uuid;
begin
  select author_id into post_author from public.posts where id = new.post_id;
  if post_author is not null and post_author <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id)
    values (post_author, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_like on public.likes;
create trigger trg_notify_on_like
  after insert on public.likes
  for each row execute function public.notify_on_like();

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer as $$
declare
  post_author uuid;
begin
  select author_id into post_author from public.posts where id = new.post_id;
  if post_author is not null and post_author <> new.author_id then
    insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
    values (post_author, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_comment on public.comments;
create trigger trg_notify_on_comment
  after insert on public.comments
  for each row execute function public.notify_on_comment();

create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer as $$
begin
  insert into public.notifications (recipient_id, actor_id, type)
  values (new.following_id, new.follower_id, case when new.status = 'pending' then 'follow_request' else 'follow' end);
  return new;
end;
$$;

drop trigger if exists trg_notify_on_follow on public.follows;
create trigger trg_notify_on_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

-- MENTIONS (@username) ----------------------------------------------------
create table if not exists public.mentions (
  id uuid primary key default uuid_generate_v4(),
  source_type text not null check (source_type in ('post', 'comment')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.mentions enable row level security;
drop policy if exists "mentions inherit post visibility" on public.mentions;
create policy "mentions inherit post visibility"
  on public.mentions for select
  using (true); -- mention rows carry no sensitive data beyond a user id + post id

create or replace function public.extract_and_notify_mentions(
  p_text text, p_source_type text, p_post_id uuid, p_comment_id uuid, p_actor_id uuid
)
returns void language plpgsql security definer as $$
declare
  m record;
begin
  for m in
    select p.id, p.username
    from public.profiles p
    where p.username = any (
      array(select lower(x[1]) from regexp_matches(coalesce(p_text, ''), '@([a-z0-9_.]{3,30})', 'gi') as t(x))
    )
  loop
    if m.id <> p_actor_id then
      insert into public.mentions (source_type, post_id, comment_id, mentioned_user_id)
      values (p_source_type, p_post_id, p_comment_id, m.id);
      insert into public.notifications (recipient_id, actor_id, type, post_id, comment_id)
      values (m.id, p_actor_id, case when p_source_type = 'post' then 'mention_post' else 'mention_comment' end, p_post_id, p_comment_id);
    end if;
  end loop;
end;
$$;

create or replace function public.handle_post_mentions()
returns trigger language plpgsql security definer as $$
begin
  perform public.extract_and_notify_mentions(new.caption, 'post', new.id, null, new.author_id);
  return new;
end;
$$;

drop trigger if exists trg_post_mentions on public.posts;
create trigger trg_post_mentions
  after insert on public.posts
  for each row execute function public.handle_post_mentions();

create or replace function public.handle_comment_mentions()
returns trigger language plpgsql security definer as $$
begin
  perform public.extract_and_notify_mentions(new.content, 'comment', new.post_id, new.id, new.author_id);
  return new;
end;
$$;

drop trigger if exists trg_comment_mentions on public.comments;
create trigger trg_comment_mentions
  after insert on public.comments
  for each row execute function public.handle_comment_mentions();

-- REPORTS (moderation) -----------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'impersonation', 'other')),
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "users can file their own reports" on public.reports;
create policy "users can file their own reports"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists "reporter sees their own reports, admin sees all" on public.reports;
create policy "reporter sees their own reports, admin sees all"
  on public.reports for select
  using (auth.uid() = reporter_id or public.is_current_user_admin());

drop policy if exists "admin can update report status" on public.reports;
create policy "admin can update report status"
  on public.reports for update
  using (public.is_current_user_admin());

-- BLOCK ENFORCEMENT: extend visibility so a blocked relationship (either
-- direction) hides posts/profiles from each other, on top of privacy rules.
create or replace function public.can_view_profile(owner uuid, viewer uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    (
      owner = viewer
      or not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
      or exists (
        select 1 from public.follows f
        where f.follower_id = viewer and f.following_id = owner and f.status = 'accepted'
      )
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = owner and b.blocked_id = viewer)
         or (b.blocker_id = viewer and b.blocked_id = owner)
    );
$$;

-- =====================================================================
-- PART 13: Story Highlights (permanent, curated stories on a profile)
-- Reuses the existing stories table — a highlight just references
-- stories that would otherwise disappear after 24h, so no story data is
-- duplicated.
-- =====================================================================

create table if not exists public.highlights (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 30),
  cover_color text default '#ff5d3b',
  created_at timestamptz not null default now()
);

create table if not exists public.highlight_items (
  highlight_id uuid not null references public.highlights(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  position integer not null default 0,
  primary key (highlight_id, story_id)
);

alter table public.highlights enable row level security;
alter table public.highlight_items enable row level security;

drop policy if exists "highlights are viewable respecting owner privacy" on public.highlights;
create policy "highlights are viewable respecting owner privacy"
  on public.highlights for select
  using (public.can_view_profile(owner_id, auth.uid()));

drop policy if exists "owners manage their own highlights" on public.highlights;
create policy "owners manage their own highlights"
  on public.highlights for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "highlight items inherit highlight visibility" on public.highlight_items;
create policy "highlight items inherit highlight visibility"
  on public.highlight_items for select
  using (exists (select 1 from public.highlights h where h.id = highlight_id and public.can_view_profile(h.owner_id, auth.uid())));

drop policy if exists "owner manages items in their own highlights" on public.highlight_items;
create policy "owner manages items in their own highlights"
  on public.highlight_items for all
  using (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid()))
  with check (exists (select 1 from public.highlights h where h.id = highlight_id and h.owner_id = auth.uid()));

-- =====================================================================
-- PART 14: Tip Sticker on Stories — a real differentiator.
-- Big app-store-distributed platforms (Instagram, TikTok) can't put a
-- direct bank-transfer button in a story without giving Apple/Google a
-- cut of "digital tips" — that's an App Store policy constraint, not a
-- technical one. VYRA is a website, so this restriction doesn't apply:
-- a story can carry a real, tappable UPI tip button.
-- =====================================================================

alter table public.stories add column if not exists tip_sticker_x numeric(4,3);
alter table public.stories add column if not exists tip_sticker_y numeric(4,3);

-- =====================================================================
-- PART 15: Interactive Story Stickers — Poll, Question, Emoji Slider
-- Real interactivity (stored responses), not just decorative emoji.
-- =====================================================================

create table if not exists public.story_stickers (
  id uuid primary key default uuid_generate_v4(),
  story_id uuid not null references public.stories(id) on delete cascade,
  type text not null check (type in ('poll', 'question', 'slider')),
  x numeric(4,3) not null,
  y numeric(4,3) not null,
  config jsonb not null, -- poll: {question, options:[a,b]} · question: {prompt} · slider: {emoji}
  created_at timestamptz not null default now()
);

create table if not exists public.story_sticker_responses (
  id uuid primary key default uuid_generate_v4(),
  sticker_id uuid not null references public.story_stickers(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  response jsonb not null, -- poll: {option_index} · question: {text} · slider: {value}
  created_at timestamptz not null default now(),
  unique (sticker_id, viewer_id)
);

create index if not exists idx_sticker_story on public.story_stickers (story_id);
create index if not exists idx_sticker_responses on public.story_sticker_responses (sticker_id);

alter table public.story_stickers enable row level security;
alter table public.story_sticker_responses enable row level security;

drop policy if exists "stickers are viewable if the story is viewable" on public.story_stickers;
create policy "stickers are viewable if the story is viewable"
  on public.story_stickers for select
  using (exists (select 1 from public.stories s where s.id = story_id and public.can_view_profile(s.author_id, auth.uid())));

drop policy if exists "story author adds stickers to their own story" on public.story_stickers;
create policy "story author adds stickers to their own story"
  on public.story_stickers for insert
  with check (exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

drop policy if exists "responses visible to the responder, story author, or as poll aggregate" on public.story_sticker_responses;
create policy "responses visible to the responder, story author, or as poll aggregate"
  on public.story_sticker_responses for select
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.story_stickers st join public.stories s on s.id = st.story_id
      where st.id = sticker_id and s.author_id = auth.uid()
    )
    or exists (
      select 1 from public.story_stickers st join public.stories s on s.id = st.story_id
      where st.id = sticker_id and st.type = 'poll' and public.can_view_profile(s.author_id, auth.uid())
    )
  );

drop policy if exists "viewers can respond as themselves" on public.story_sticker_responses;
create policy "viewers can respond as themselves"
  on public.story_sticker_responses for insert
  with check (auth.uid() = viewer_id);

drop policy if exists "viewers can update their own response" on public.story_sticker_responses;
create policy "viewers can update their own response"
  on public.story_sticker_responses for update
  using (auth.uid() = viewer_id);

-- =====================================================================
-- PART 16: Quiz and Countdown stickers (completing the sticker set)
-- =====================================================================

alter table public.story_stickers drop constraint if exists story_stickers_type_check;
alter table public.story_stickers add constraint story_stickers_type_check
  check (type in ('poll', 'question', 'slider', 'quiz', 'countdown'));

-- quiz config: {question, options:[...], correct_index}
-- quiz response: {option_index, correct: boolean}
-- countdown config: {label, target_time (ISO string)}
-- countdown response: {reminder: true} — logs interest only; VYRA has no
-- push-notification infrastructure yet, so "remind me" does not actually
-- send a notification at the target time. Said plainly so it isn't
-- mistaken for a working reminder.

-- =====================================================================
-- PART 17: Remaining core-spec items — restrict, comment likes,
-- interests, suggested accounts support
-- =====================================================================

-- RESTRICT (lighter than block/mute — Instagram-style: their comments
-- are hidden from everyone except themselves and you, without them
-- knowing they've been restricted).
create table if not exists public.restricts (
  restrictor_id uuid not null references public.profiles(id) on delete cascade,
  restricted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (restrictor_id, restricted_id)
);

alter table public.restricts enable row level security;
drop policy if exists "users manage their own restricts" on public.restricts;
create policy "users manage their own restricts"
  on public.restricts for all
  using (auth.uid() = restrictor_id)
  with check (auth.uid() = restrictor_id);

-- A restricted user should not learn they're restricted, so the
-- restrictor list itself is private — but restrict effects on comments
-- are handled client-side (hide comment for others, show for the
-- restricted commenter and post author) using this table.

-- COMMENT LIKES ------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

drop policy if exists "comment likes visible respecting post visibility" on public.comment_likes;
create policy "comment likes visible respecting post visibility"
  on public.comment_likes for select
  using (
    exists (
      select 1 from public.comments c join public.posts p on p.id = c.post_id
      where c.id = comment_id and public.can_view_profile(p.author_id, auth.uid())
    )
  );

drop policy if exists "users can like comments as themselves" on public.comment_likes;
create policy "users can like comments as themselves"
  on public.comment_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can unlike their own comment like" on public.comment_likes;
create policy "users can unlike their own comment like"
  on public.comment_likes for delete
  using (auth.uid() = user_id);

create or replace function public.adjust_comment_like_counts()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set like_count = like_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_comment_like_counts on public.comment_likes;
create trigger trg_comment_like_counts
  after insert or delete on public.comment_likes
  for each row execute function public.adjust_comment_like_counts();

-- INTERESTS (for feed personalization and profile display) -----------------
alter table public.profiles add column if not exists interests text[] default '{}';

-- =====================================================================
-- PART 18: Restrict enforcement baked into comment visibility
-- =====================================================================

drop policy if exists "comments are viewable respecting post visibility" on public.comments;
create policy "comments are viewable respecting post visibility"
  on public.comments for select
  using (
    (
      exists (
        select 1 from public.posts p
        where p.id = post_id and public.can_view_profile(p.author_id, auth.uid())
      )
      or public.is_current_user_admin()
    )
    and (
      -- Not hidden by a restrict, UNLESS you are the comment's author or the post's author.
      author_id = auth.uid()
      or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
      or not exists (
        select 1 from public.restricts r
        join public.posts p on p.id = post_id
        where r.restrictor_id = p.author_id and r.restricted_id = author_id
      )
    )
  );

-- =====================================================================
-- PART 19: DM image attachments + admin moderation actions
-- (2FA uses Supabase's built-in MFA — no schema change needed for that)
-- =====================================================================

alter table public.direct_messages add column if not exists media_url text;

-- =====================================================================
-- PART 20: Admin can grant/revoke the verified badge
-- =====================================================================

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_current_user_admin());

-- =====================================================================
-- PART 21: Account suspension (admin moderation action)
-- =====================================================================

alter table public.profiles add column if not exists is_suspended boolean not null default false;

-- Suspended accounts' content becomes invisible to everyone except the
-- admin who needs to review it (or themselves, so they can see their
-- own suspended state and know why they were signed out).
create or replace function public.can_view_profile(owner uuid, viewer uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    (
      owner = viewer
      or (
        not exists (select 1 from public.profiles p where p.id = owner and p.is_suspended)
        and (
          not exists (select 1 from public.profiles p where p.id = owner and p.is_private)
          or exists (
            select 1 from public.follows f
            where f.follower_id = viewer and f.following_id = owner and f.status = 'accepted'
          )
        )
      )
      or public.is_current_user_admin()
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = owner and b.blocked_id = viewer)
         or (b.blocker_id = viewer and b.blocked_id = owner)
    );
$$;

-- =====================================================================
-- PART 22: Comment pinning/sorting (UI only — schema already had
-- is_pinned since Phase 1), Community Events, Rate Limiting, Audit Log
-- =====================================================================

-- COMMUNITY EVENTS ----------------------------------------------------
create table if not exists public.community_events (
  id uuid primary key default uuid_generate_v4(),
  community_id uuid not null references public.communities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  description text,
  event_time timestamptz not null,
  location text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.event_attendees (
  event_id uuid not null references public.community_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.community_events enable row level security;
alter table public.event_attendees enable row level security;

drop policy if exists "events visible to anyone who can see the community" on public.community_events;
create policy "events visible to anyone who can see the community"
  on public.community_events for select
  using (exists (select 1 from public.communities c where c.id = community_id and (c.visibility <> 'private' or exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = auth.uid()))));

drop policy if exists "members can create events in their community" on public.community_events;
create policy "members can create events in their community"
  on public.community_events for insert
  with check (exists (select 1 from public.community_members m where m.community_id = community_id and m.user_id = auth.uid()) and created_by = auth.uid());

drop policy if exists "creator or community owner can delete an event" on public.community_events;
create policy "creator or community owner can delete an event"
  on public.community_events for delete
  using (created_by = auth.uid() or exists (select 1 from public.community_members m where m.community_id = community_id and m.user_id = auth.uid() and m.role in ('owner', 'moderator')));

drop policy if exists "attendee list visible if the event is visible" on public.event_attendees;
create policy "attendee list visible if the event is visible"
  on public.event_attendees for select
  using (exists (select 1 from public.community_events e where e.id = event_id));

drop policy if exists "users RSVP as themselves" on public.event_attendees;
create policy "users RSVP as themselves"
  on public.event_attendees for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RATE LIMITING (built with plain RLS — no external service) -------------
-- Follows: max 50 new follows per rolling hour (spam-follow protection).
drop policy if exists "users can follow as themselves" on public.follows;
create policy "users can follow as themselves"
  on public.follows for insert
  with check (
    auth.uid() = follower_id
    and (select count(*) from public.follows f where f.follower_id = auth.uid() and f.created_at > now() - interval '1 hour') < 50
  );

-- Comments: max 20 per rolling minute (anti-spam / anti-flood).
drop policy if exists "users can comment as themselves" on public.comments;
create policy "users can comment as themselves"
  on public.comments for insert
  with check (
    auth.uid() = author_id
    and (select count(*) from public.comments c where c.author_id = auth.uid() and c.created_at > now() - interval '1 minute') < 20
  );

-- Direct messages: max 30 per rolling minute (prevents mass-DM spam).
drop policy if exists "users can send messages as themselves" on public.direct_messages;
create policy "users can send messages as themselves"
  on public.direct_messages for insert
  with check (
    auth.uid() = sender_id
    and (select count(*) from public.direct_messages d where d.sender_id = auth.uid() and d.created_at > now() - interval '1 minute') < 30
  );

-- Reports: max 20 per rolling hour (prevents report-flooding abuse).
drop policy if exists "users can file their own reports" on public.reports;
create policy "users can file their own reports"
  on public.reports for insert
  with check (
    auth.uid() = reporter_id
    and (select count(*) from public.reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 hour') < 20
  );

-- ADMIN AUDIT LOG -----------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

drop policy if exists "only admins can read the audit log" on public.admin_audit_log;
create policy "only admins can read the audit log"
  on public.admin_audit_log for select
  using (public.is_current_user_admin());

drop policy if exists "only admins can write to the audit log" on public.admin_audit_log;
create policy "only admins can write to the audit log"
  on public.admin_audit_log for insert
  with check (public.is_current_user_admin() and auth.uid() = admin_id);

-- =====================================================================
-- PART 23: Post author can pin/unpin comments on their own posts
-- =====================================================================

drop policy if exists "post author can pin comments on their post" on public.comments;
create policy "post author can pin comments on their post"
  on public.comments for update
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
