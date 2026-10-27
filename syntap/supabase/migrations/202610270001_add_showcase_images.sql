alter table public.digital_cards
  add column if not exists showcase_images jsonb not null default '[]'::jsonb
    check (jsonb_typeof(showcase_images) = 'array' and jsonb_array_length(showcase_images) <= 6);

alter table public.digital_cards
  alter column theme_settings set default
    '{"theme":"light","primary":"#111827","button_appearance":"soft","button_shape":"rounded","alignment":"center","button_layout":"default"}'::jsonb;

drop policy if exists "Published profile images are readable" on storage.objects;
create policy "Published profile images are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'card-media'
    and exists (
      select 1
      from public.digital_cards
      where status = 'published'
        and (
          storage.objects.name in (profile_image, company_logo, cover_image)
          or showcase_images ? storage.objects.name
        )
    )
  );
