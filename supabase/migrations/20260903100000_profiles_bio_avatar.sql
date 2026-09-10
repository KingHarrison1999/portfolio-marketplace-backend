-- Step 8 profile management (GET/PATCH /api/profile) needs somewhere to
-- store a bio/description and an avatar reference -- neither existed on
-- profiles before. avatar_url follows the same plain-URL-string pattern
-- as ad_spaces.image_url: no upload endpoint here, that's a separate
-- feature, same as it was for ad spaces and listing images before them.

alter table public.profiles add column bio text;
alter table public.profiles add column avatar_url text;
