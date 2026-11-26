-- Row Level Security. Run AFTER 001_schema.sql. Safe to run more than once.
alter table public.categories         enable row level security;
alter table public.artists            enable row level security;
alter table public.songs              enable row level security;
alter table public.posts              enable row level security;
alter table public.post_comments      enable row level security;
alter table public.country_views      enable row level security;
alter table public.page_views         enable row level security;
alter table public.subscribers        enable row level security;
alter table public.chat_threads       enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.admin_users        enable row level security;
alter table public.team_members       enable row level security;
alter table public.authors            enable row level security;
alter table public.site_settings      enable row level security;
alter table public.site_secrets       enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

grant select on public.categories, public.artists, public.songs, public.posts, public.post_comments to anon, authenticated;

drop policy if exists "public read categories" on public.categories;
drop policy if exists "public read artists"    on public.artists;
drop policy if exists "public read songs"      on public.songs;
drop policy if exists "public read posts"      on public.posts;
drop policy if exists "public read comments"   on public.post_comments;
create policy "public read categories" on public.categories    for select to anon, authenticated using (true);
create policy "public read artists"    on public.artists       for select to anon, authenticated using (true);
create policy "public read songs"      on public.songs         for select to anon, authenticated using (true);
create policy "public read posts"      on public.posts         for select to anon, authenticated using (true);
create policy "public read comments"   on public.post_comments for select to anon, authenticated using (true);
-- No write policies exist: browsers cannot insert/update/delete. Every other table has no policies at all.
