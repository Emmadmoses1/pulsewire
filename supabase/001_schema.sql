-- PulseWire / WAVZO  ->  Supabase schema.  Safe to run more than once.
create table if not exists public.categories (
  slug        text primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.artists (
  id             text primary key,
  name           text,
  genre          text,
  bio            text,
  slug           text unique,
  photo          text,
  created_at_ms  bigint,
  legacy_pos     integer not null default 0,
  extra          jsonb   not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.songs (
  id             text primary key,
  title          text,
  artist_id      text references public.artists(id) on update cascade on delete set null,
  type           text,
  excerpt        text,
  download_url   text,
  youtube_url    text,
  cover          text,
  slug           text unique,
  created_at_ms  bigint,
  album          text,
  track_number   integer,
  downloads      integer not null default 0 check (downloads >= 0),
  album_id       text,
  album_cover    text,
  year           text,
  genre          text,
  legacy_pos     integer not null default 0,
  extra          jsonb   not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create table if not exists public.posts (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug <> ''),
  title            text not null default '',
  category         text,
  excerpt          text,
  content          text,
  cover_image      text,
  music_file       text,
  video_file       text,
  date_label       text,
  created_at_ms    bigint,
  views            integer not null default 0 check (views >= 0),
  downloads        integer not null default 0 check (downloads >= 0),
  audio_downloads  integer not null default 0 check (audio_downloads >= 0),
  video_downloads  integer not null default 0 check (video_downloads >= 0),
  reactions        jsonb   not null default '{}'::jsonb,
  pinned           boolean not null default false,
  source_url       text,
  source           jsonb,
  auto             jsonb,
  legacy_pos       integer not null default 0,
  extra            jsonb   not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists posts_order_idx     on public.posts (legacy_pos);
create index if not exists posts_created_idx   on public.posts (created_at_ms desc);
create index if not exists posts_category_idx  on public.posts (category, created_at_ms desc);
create index if not exists posts_pinned_idx    on public.posts (pinned) where pinned;
create index if not exists posts_source_idx    on public.posts (source_url) where source_url is not null;
create index if not exists songs_artist_idx    on public.songs (artist_id);
create index if not exists songs_order_idx     on public.songs (legacy_pos);
create index if not exists artists_order_idx   on public.artists (legacy_pos);

create table if not exists public.post_comments (
  id         text primary key,
  post_slug  text not null references public.posts(slug) on update cascade on delete cascade,
  parent_id  text references public.post_comments(id) on delete cascade,
  pos        integer not null default 0,
  name       text,
  body       text,
  ts_ms      bigint,
  likes      integer not null default 0 check (likes >= 0),
  extra      jsonb not null default '{}'::jsonb
);
create index if not exists comments_post_idx   on public.post_comments (post_slug);
create index if not exists comments_parent_idx on public.post_comments (parent_id);

create table if not exists public.country_views (
  country  text primary key,
  views    bigint not null default 0 check (views >= 0)
);
create table if not exists public.page_views (
  id       bigint generated always as identity primary key,
  path     text,
  ip       text,
  country  text,
  time_ms  bigint
);
create index if not exists page_views_time_idx on public.page_views (time_ms);
create index if not exists page_views_path_idx on public.page_views (path);

create table if not exists public.subscribers (
  email       text primary key check (email = lower(email) and position('@' in email) > 1),
  created_at  timestamptz not null default now()
);
create table if not exists public.chat_threads (
  id             text primary key,
  name           text,
  created_at_ms  bigint
);
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  thread_id  text not null references public.chat_threads(id) on delete cascade,
  sender     text not null check (sender in ('visitor','admin')),
  body       text,
  time_ms    bigint
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, time_ms);
create table if not exists public.push_subscriptions (
  endpoint  text primary key,
  p256dh    text,
  auth      text,
  t_ms      bigint
);

create table if not exists public.admin_users (
  username         text primary key,
  credential       text,
  credential_kind  text not null default 'unknown',
  extra            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create table if not exists public.team_members (id text primary key, data jsonb not null default '{}'::jsonb);
create table if not exists public.authors      (id text primary key, data jsonb not null default '{}'::jsonb);

create table if not exists public.site_settings (key text primary key, value jsonb, updated_at timestamptz not null default now());
create table if not exists public.site_secrets  (key text primary key, value jsonb, updated_at timestamptz not null default now());

create or replace function public.bump_post_counter(p_slug text, p_field text, p_by integer default 1)
returns void language plpgsql set search_path = public as $$
begin
  if p_field not in ('views','downloads','audio_downloads','video_downloads') then
    raise exception 'bad counter field: %', p_field;
  end if;
  execute format('update public.posts set %I = %I + $1 where slug = $2', p_field, p_field) using p_by, p_slug;
end $$;

create or replace function public.bump_country_view(p_country text)
returns void language sql set search_path = public as $$
  insert into public.country_views (country, views) values (p_country, 1)
  on conflict (country) do update set views = public.country_views.views + 1;
$$;
