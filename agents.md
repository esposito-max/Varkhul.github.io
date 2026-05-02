# Chronicle & Character — Codex Project Primer

## 0. Purpose of this document

This file is the project handoff for Codex. Treat it as the authoritative product and architecture brief for building **Chronicle & Character**, a custom campaign-management and character-creation web app for a D&D campaign setting called **Varkhul**.

The goal is not to clone D&D Beyond. The goal is to build a smaller, campaign-specific tool that helps new players enter the setting, read approved lore, and create beginner-friendly characters using only the features the DM actually needs.

---

# 1. Product summary

## Product name

**Chronicle & Character**

## Product type

A custom **D&D campaign companion web app**.

## Core idea

The DM writes and organizes lore in Obsidian. A sync script imports selected Markdown notes into a Supabase database. A Flutter Web app lets players log in, read only lore the DM has made available, and create their own characters through a guided, newbie-friendly character creator.

The DM has a separate control view where they can:

* See all player characters.
* Open player character sheets in read-only mode.
* Toggle lore entries visible or hidden.
* Manage the campaign-facing lore library without exposing DM-only notes.

---

# 2. Non-negotiable project requirements

## Required

* Use **Flutter** for the frontend.
* Use **Supabase** for backend, authentication, database, and Row Level Security.
* Use **PostgreSQL** through Supabase.
* Use a **Python sync script** to import selected Obsidian Markdown files into Supabase.
* Use **Supabase Auth** for individualized player accounts.
* Use **Row Level Security** to enforce permissions in the database, not only in the frontend.
* Players can create, edit, and view only their own characters.
* The DM can view all player characters but must not modify them in the initial version.
* The DM can toggle lore visibility.
* Players can only read lore marked as visible.
* The app must support beginner-friendly character creation.
* The app must be structured for future expansion.

## Explicitly not required

Do **not** implement the following unless specifically requested later:

* Dice rolling.
* PDF export.
* Full D&D Beyond clone behavior.
* Encounter builder.
* Combat tracker.
* Inventory marketplace.
* Automated levelling beyond the MVP.
* Full official D&D rules compendium.
* Public user-generated homebrew marketplace.
* Obsidian plugin.
* Quartz.
* Astro.

---

# 3. Technical stack

## Frontend

* Flutter Web
* Dart
* Riverpod for state management
* GoRouter for routing
* Supabase Flutter client
* Markdown rendering package for lore display

Recommended Flutter packages:

```yaml
dependencies:
  flutter:
    sdk: flutter
  supabase_flutter: ^latest
  flutter_riverpod: ^latest
  go_router: ^latest
  flutter_markdown: ^latest
  freezed_annotation: ^latest
  json_annotation: ^latest


dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^latest
  freezed: ^latest
  json_serializable: ^latest
  flutter_lints: ^latest
```

If the latest versions cause incompatibilities, choose stable compatible versions and document the decision.

## Backend

* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Row Level Security
* Optional later: Supabase Edge Functions for privileged operations

## Lore source

* Obsidian Markdown vault
* YAML frontmatter / Obsidian Properties
* Python sync script

## Hosting

Acceptable options:

* Supabase Hosting if available in the project environment
* Netlify
* Vercel
* Firebase Hosting
* Any static web host that can serve the `build/web` output from Flutter

---

# 4. Mental model

The Obsidian vault is not the website.

The vault is the **private authoring environment**.

Supabase is the **public application database**.

Flutter is the **actual player-facing and DM-facing app**.

The sync script is the **bridge**.

```text
Obsidian Vault
   |
   | Python sync script
   v
Supabase PostgreSQL
   |
   | Supabase Auth + RLS
   v
Flutter Web App
   |
   v
Players and DM
```

---

# 5. User roles

## Player

A player can:

* Sign up / sign in.
* View only visible lore.
* Search and filter visible lore.
* Create their own character.
* Edit their own character.
* View their own character sheet.
* Save character creation progress.

A player cannot:

* View hidden lore.
* View another player’s character.
* Modify another player’s character.
* Toggle lore visibility.
* Access DM-only dashboard pages.

## DM

A DM can:

* Sign in.
* View all lore entries.
* Toggle lore visibility.
* View all player characters.
* Open any player character sheet in read-only mode.
* See player account/profile metadata needed for campaign administration.

A DM cannot in MVP:

* Modify player sheets.
* Delete player characters.
* Impersonate players.

Future admin features can be added later, but the first version should keep the DM role intentionally conservative.

---

# 6. MVP scope

Build the first version as a focused MVP.

## MVP features

### Authentication

* Register account.
* Login.
* Logout.
* Automatically create a profile row after signup.
* Role support: `dm` and `player`.

### Lore library

* Player-facing list of visible lore entries.
* Lore detail page rendering Markdown.
* Search by title/content.
* Filter by tags/category.
* DM lore admin page showing both visible and hidden entries.
* DM can toggle `is_visible`.

### Character creator

A guided wizard for beginner players.

Initial MVP should support **Level 1 characters only**.

Suggested steps:

1. Character concept
2. Species
3. Class
4. Background
5. Ability scores
6. Skills
7. Equipment notes
8. Review and create

### Character sheets

* Player can view their own sheet.
* Player can edit their own sheet.
* DM can view all sheets read-only.

### DM dashboard

* List all player characters.
* Open each sheet read-only.
* Lore visibility manager.

---

# 7. Database design

Implement database schema through SQL migrations.

Use explicit migrations instead of manually editing tables through the Supabase dashboard when possible.

## 7.1 Extensions

```sql
create extension if not exists "pgcrypto";
```

## 7.2 Role enum

```sql
do $$ begin
  create type public.user_role as enum ('dm', 'player');
exception
  when duplicate_object then null;
end $$;
```

## 7.3 Profiles table

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  role public.user_role not null default 'player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.4 Lore entries table

```sql
create table if not exists public.lore_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content text not null,
  excerpt text,
  category text,
  tags text[] not null default '{}',
  is_visible boolean not null default false,
  spoiler_level int not null default 0,
  source_path text,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Notes

* `slug` is the stable import key from Obsidian.
* `source_path` helps trace which vault file produced the row.
* `source_hash` helps the sync script avoid unnecessary updates.
* `is_visible` controls public lore access.
* `spoiler_level` is for future use.

## 7.5 Characters table

Use `jsonb` for the first version. This keeps the system flexible while the rules and character creator are still evolving.

```sql
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  species text,
  class_name text,
  background text,
  level int not null default 1 check (level >= 1),
  sheet_data jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 7.6 Optional rules tables for MVP

The first version can store character rules as app-side JSON or database rows. Prefer database rows if the DM wants to update options without redeploying the frontend.

Recommended tables:

```sql
create table if not exists public.species_options (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  traits jsonb not null default '[]'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.class_options (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  features jsonb not null default '[]'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.background_options (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  benefits jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

If these tables slow down the first implementation, defer them and use local seeded JSON files in Flutter.

---

# 8. Updated timestamp trigger

Create one function and reuse it.

```sql
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
```

Apply to tables:

```sql
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_lore_entries_updated_at on public.lore_entries;
create trigger set_lore_entries_updated_at
before update on public.lore_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_characters_updated_at on public.characters;
create trigger set_characters_updated_at
before update on public.characters
for each row execute function public.set_updated_at();
```

---

# 9. Helper functions for security

Create a helper function to check whether the current user is a DM.

```sql
create or replace function public.is_dm()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
    and role = 'dm'
  );
$$;
```

Important: keep this function simple and stable. It is used inside RLS policies.

---

# 10. Row Level Security policies

Enable RLS on all public tables.

```sql
alter table public.profiles enable row level security;
alter table public.lore_entries enable row level security;
alter table public.characters enable row level security;
```

If using option tables:

```sql
alter table public.species_options enable row level security;
alter table public.class_options enable row level security;
alter table public.background_options enable row level security;
```

## 10.1 Profiles policies

```sql
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "DMs can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_dm());

create policy "Users can update own username only"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
```

Do not allow normal users to update their own role from the frontend.

Role promotion should be done manually in Supabase or through a secure server-side operation later.

## 10.2 Lore policies

```sql
create policy "Players can read visible lore"
on public.lore_entries
for select
to authenticated
using (is_visible = true);

create policy "DMs can read all lore"
on public.lore_entries
for select
to authenticated
using (public.is_dm());

create policy "DMs can insert lore"
on public.lore_entries
for insert
to authenticated
with check (public.is_dm());

create policy "DMs can update lore"
on public.lore_entries
for update
to authenticated
using (public.is_dm())
with check (public.is_dm());

create policy "DMs can delete lore"
on public.lore_entries
for delete
to authenticated
using (public.is_dm());
```

For automated sync using a service role key, the Python script should run from a private local machine or secure environment. Never expose a service role key in the Flutter app.

## 10.3 Character policies

```sql
create policy "Players can read own characters"
on public.characters
for select
to authenticated
using (owner_id = auth.uid());

create policy "Players can insert own characters"
on public.characters
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Players can update own characters"
on public.characters
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Players can delete own characters"
on public.characters
for delete
to authenticated
using (owner_id = auth.uid());

create policy "DMs can read all characters"
on public.characters
for select
to authenticated
using (public.is_dm());
```

Do not create a DM update policy for characters in MVP.

## 10.4 Option table policies

```sql
create policy "Authenticated users can read enabled species options"
on public.species_options
for select
to authenticated
using (is_enabled = true or public.is_dm());

create policy "DMs can manage species options"
on public.species_options
for all
to authenticated
using (public.is_dm())
with check (public.is_dm());
```

Repeat equivalent policies for `class_options` and `background_options`.

---

# 11. Automatic profile creation

When a new auth user signs up, create a profile row.

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    'player'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

---

# 12. Obsidian lore format

The sync script should read Markdown files from selected folders and require frontmatter.

Example note:

```markdown
---
title: "The Holy Church of First Light"
slug: "holy-church-first-light"
category: "Institution"
tags:
  - religion
  - first-light
  - khuviora
visible: true
spoiler_level: 0
player_safe: true
---

The Holy Church of First Light claims continuity with the first divine ordinances...
```

## Required frontmatter fields

* `title`
* `slug`

## Optional frontmatter fields

* `category`
* `tags`
* `visible`
* `spoiler_level`
* `player_safe`

## Behavior

* If `visible` is missing, default to `false`.
* If `player_safe` is false, do not sync the file unless an explicit override flag is used.
* If `slug` is missing, either generate one from the title or fail with a clear error. Prefer failing at first to prevent accidental unstable URLs.
* If duplicate slugs are found, stop the sync and report the duplicate files.

---

# 13. Python sync script requirements

Create a `tools/sync_lore.py` script.

## Responsibilities

The script should:

1. Load environment variables.
2. Walk selected Obsidian directories.
3. Read `.md` files.
4. Parse YAML frontmatter.
5. Validate required fields.
6. Compute a content hash.
7. Upsert into Supabase by `slug`.
8. Skip unchanged files when possible.
9. Print a clear summary of created, updated, skipped, and failed entries.

## Recommended Python packages

```txt
python-dotenv
PyYAML
python-frontmatter
supabase
python-slugify
```

## Environment variables

Create `.env.example`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OBSIDIAN_VAULT_PATH=
LORE_INCLUDE_DIRS=Lore,Player Visible,Rules
```

Do not commit the real `.env` file.

## Script behavior

Pseudo-flow:

```text
load env
connect to Supabase using service role key
for every markdown file in allowed folders:
  parse frontmatter
  validate title and slug
  if player_safe == false: skip
  prepare row
  hash content + relevant metadata
  check existing lore_entries row by slug
  if no row: insert
  if row exists and hash changed: update
  if row exists and hash same: skip
print summary
```

## Obsidian link conversion

Handle simple Obsidian wikilinks.

Examples:

```text
[[Khuviorian Sanctum]] -> Khuviorian Sanctum
[[khuviorian-sanctum|the Sanctum]] -> the Sanctum
```

In the MVP, plain text conversion is acceptable. Later, internal lore links can become clickable routes.

---

# 14. Flutter app structure

Create a clean feature-first structure.

```text
lib/
  main.dart
  app.dart

  core/
    config/
      env.dart
    routing/
      app_router.dart
      route_names.dart
    theme/
      app_theme.dart
    auth/
      auth_state_provider.dart
      auth_gate.dart
    errors/
      app_exception.dart

  models/
    profile.dart
    lore_entry.dart
    character.dart
    character_sheet_data.dart
    species_option.dart
    class_option.dart
    background_option.dart

  services/
    supabase_service.dart
    profile_service.dart
    lore_service.dart
    character_service.dart
    option_service.dart

  features/
    auth/
      login_page.dart
      register_page.dart
      account_page.dart

    lore/
      lore_list_page.dart
      lore_detail_page.dart
      lore_search_controller.dart
      widgets/
        lore_card.dart
        tag_chip.dart

    characters/
      character_list_page.dart
      character_sheet_page.dart
      character_editor_page.dart
      creator/
        character_creator_page.dart
        character_creator_controller.dart
        character_creator_state.dart
        steps/
          concept_step.dart
          species_step.dart
          class_step.dart
          background_step.dart
          ability_scores_step.dart
          skills_step.dart
          equipment_step.dart
          review_step.dart
      widgets/
        ability_score_block.dart
        proficiency_badge.dart
        trait_card.dart

    dm/
      dm_dashboard_page.dart
      dm_lore_admin_page.dart
      dm_character_list_page.dart
      dm_character_readonly_page.dart
      widgets/
        visibility_toggle.dart
        player_character_card.dart
```

---

# 15. Routing requirements

Use GoRouter.

Suggested routes:

```text
/login
/register
/account
/lore
/lore/:slug
/characters
/characters/new
/characters/:id
/dm
/dm/lore
/dm/characters
/dm/characters/:id
```

## Route guards

* Unauthenticated users go to `/login`.
* Authenticated players cannot access `/dm` routes.
* DM users can access `/dm` routes.
* If role is unknown/loading, show a loading state.

---

# 16. Data models

Use typed Dart models. Prefer `freezed` and `json_serializable` if possible.

## Profile model

Fields:

* `id`
* `username`
* `role`
* `createdAt`
* `updatedAt`

## LoreEntry model

Fields:

* `id`
* `slug`
* `title`
* `content`
* `excerpt`
* `category`
* `tags`
* `isVisible`
* `spoilerLevel`
* `sourcePath`
* `createdAt`
* `updatedAt`

## Character model

Fields:

* `id`
* `ownerId`
* `name`
* `species`
* `className`
* `background`
* `level`
* `sheetData`
* `isArchived`
* `createdAt`
* `updatedAt`

## CharacterSheetData model

Initial shape:

```json
{
  "concept": {
    "shortPitch": "",
    "personality": "",
    "goals": "",
    "fears": "",
    "connectionToVarkhul": ""
  },
  "abilityScores": {
    "strength": 10,
    "dexterity": 10,
    "constitution": 10,
    "intelligence": 10,
    "wisdom": 10,
    "charisma": 10
  },
  "skills": [],
  "proficiencies": [],
  "traits": [],
  "features": [],
  "equipment": [],
  "notes": ""
}
```

---

# 17. Character creator design

The creator must be newbie-friendly.

Each step should include:

* A short explanation.
* A limited set of choices.
* Clear consequences.
* A back button.
* A next button.
* Validation before moving forward.
* Save progress when possible.

## Step 1: Character concept

Fields:

* Character name
* Short concept
* Personality
* Personal goal
* Fear or wound
* Connection to Varkhul

This should help players create characters that fit a political intrigue campaign.

## Step 2: Species

Show available species.

Each species card should include:

* Name
* Short description
* Core fantasy
* Suggested character hooks
* Traits summary

Avoid overwhelming mechanical details.

## Step 3: Class

Show available classes.

Each class card should include:

* Name
* Party role
* Complexity rating
* Short description
* Suggested Varkhul fit

## Step 4: Background

Show background options.

Each background should include:

* Name
* Description
* Skill suggestions
* Campaign hook

## Step 5: Ability scores

No dice rolling.

Use one of these approaches for MVP:

1. Standard array.
2. Point buy.
3. DM-defined array.

Recommended MVP: use a fixed array to keep things simple.

Example:

```text
15, 14, 13, 12, 10, 8
```

The UI should help players assign numbers to abilities and explain what each ability does.

## Step 6: Skills

Display allowed skill choices based on background/class/species data.

For MVP, a simple manual skill selection with validation is acceptable.

## Step 7: Equipment notes

Do not build a full inventory system yet.

Allow:

* Starting equipment notes.
* Important personal item.
* Optional weapon/armor text fields.

## Step 8: Review

Show final summary.

On submit:

* Insert a row in `characters`.
* Set `owner_id` to the logged-in user.
* Store structured data in `sheet_data`.

---

# 18. UI design direction

The app should feel like a serious campaign archive, not a generic SaaS dashboard.

Tone:

* Dark academia
* Ancient archive
* Liturgical, restrained, readable
* High contrast
* Minimal clutter

Use a clean layout first. Do not over-design the MVP.

## Suggested layout

### Desktop

* Left sidebar navigation
* Main content area
* Optional right metadata panel on lore detail pages

### Mobile

* Bottom navigation or drawer
* Single-column reading layout

## Visual priorities

* Good readability for lore.
* Clear buttons for players.
* Strong separation between player and DM areas.
* Avoid tiny text.
* Avoid too many nested menus.

---

# 19. Lore UI requirements

## Lore list page

Features:

* Search bar
* Category filter
* Tag chips
* Lore cards

Each lore card:

* Title
* Category
* Excerpt
* Tags

## Lore detail page

Render Markdown.

Show:

* Title
* Category
* Tags
* Last updated
* Markdown body

## DM lore admin page

Table or card list with:

* Title
* Slug
* Category
* Tags
* Visibility status
* Toggle visible/hidden

The DM page should allow fast visibility management.

---

# 20. DM dashboard requirements

The DM dashboard should include:

* Number of player characters.
* Number of visible lore entries.
* Number of hidden lore entries.
* Recent character updates.
* Link to lore admin.
* Link to all characters.

## DM character list

Show:

* Character name
* Player username
* Species
* Class
* Level
* Last updated

Clicking opens a read-only sheet.

The DM must not see edit controls on player sheets in MVP.

---

# 21. Authentication flow

Use Supabase Auth.

Minimum auth features:

* Email/password signup.
* Email/password login.
* Logout.
* Auth state persistence.

After signup:

* A profile row should be created automatically by database trigger.
* Default role is `player`.
* DM role should be assigned manually in Supabase for now.

Do not build a public “become DM” button.

---

# 22. Security rules

Critical rules:

1. Never expose `SUPABASE_SERVICE_ROLE_KEY` in Flutter.
2. All player/DM access rules must be enforced by RLS.
3. Frontend route guards are for UX only, not security.
4. DM role assignment must not be self-service.
5. Sync script may use service role key, but only from local/private environment.
6. Hidden lore must not be loaded into the client for player accounts.
7. DM read-only character view must not have an update path in MVP.

---

# 23. Repository structure

Recommended repository layout:

```text
chronicle_character/
  AGENTS.md
  README.md
  .gitignore
  .env.example

  app/
    pubspec.yaml
    lib/
    test/
    web/

  supabase/
    migrations/
      0001_initial_schema.sql
      0002_rls_policies.sql
      0003_seed_options.sql

  tools/
    sync_lore.py
    requirements.txt
    README.md

  docs/
    product_brief.md
    database_schema.md
    sync_format.md
    deployment.md
```

If the repository is a single Flutter project instead of a monorepo, place `supabase/`, `tools/`, and `docs/` at root alongside `lib/`.

---

# 24. Initial implementation phases

## Phase 1 — Scaffold

Create:

* Flutter project
* Supabase initialization
* Routing
* Theme
* Auth pages
* Empty dashboards
* Basic app shell

Definition of done:

* App runs locally.
* User can navigate between login/register.
* Auth state is detected.
* Basic route protection exists.

## Phase 2 — Database and RLS

Create:

* Supabase migrations
* Tables
* Triggers
* RLS policies
* Profile creation trigger

Definition of done:

* New user gets profile row.
* Player cannot read hidden lore.
* Player cannot read another player’s character.
* DM can read all characters.

## Phase 3 — Lore system

Create:

* LoreEntry model
* LoreService
* Lore list page
* Lore detail page
* DM lore admin page
* Visibility toggle

Definition of done:

* Player sees visible lore only.
* DM sees all lore.
* DM can toggle visibility.

## Phase 4 — Obsidian sync

Create:

* Python sync script
* `.env.example`
* Markdown/frontmatter parser
* Supabase upsert logic
* Hash-based skip behavior
* Console summary

Definition of done:

* Markdown files can be imported into Supabase.
* Duplicate slugs are detected.
* Hidden/default visibility works.
* Player-safe filtering works.

## Phase 5 — Character creator MVP

Create:

* Character model
* CharacterService
* Character list page
* Guided creator
* Character sheet page
* Save character to Supabase

Definition of done:

* Player can create one Level 1 character.
* Player can edit own character.
* Player cannot access another player’s character.
* DM can view character read-only.

## Phase 6 — Polish and validation

Create:

* Better empty states
* Loading states
* Error states
* Form validation
* Responsive layout
* Basic tests
* README setup instructions

Definition of done:

* New developer can run project from README.
* Basic auth/lore/character flows work.
* App is deployable.

---

# 25. Testing expectations

Add tests where practical.

## Flutter tests

At minimum:

* Model serialization/deserialization.
* Character creator state transitions.
* Ability score validation.
* Route guard logic if easily testable.

## Manual security tests

Test with two player accounts and one DM account.

Verify:

* Player A cannot view Player B’s character.
* Player A cannot query hidden lore.
* Player A cannot access `/dm` pages.
* DM can view Player A and Player B characters.
* DM can toggle lore visibility.
* Player sees newly visible lore after toggle.

## Sync script tests

At minimum:

* Valid file parses correctly.
* Missing slug fails.
* Missing title fails.
* Duplicate slug fails.
* `player_safe: false` skips.
* Obsidian wikilinks convert safely.

---

# 26. Copyright and content boundary

Do not hardcode copyrighted official D&D book text into the project.

For MVP, use placeholder rules data or user-provided custom Varkhul content.

Acceptable:

* User-created species.
* User-created backgrounds.
* User-created lore.
* Short mechanical labels and references needed for private use.
* Placeholder data for app development.

Avoid:

* Full copied class descriptions from official books.
* Full copied spell text from official books.
* Full copied feat descriptions from official books.
* Large official rules compendium replication.

If implementing 2024 D&D compatibility later, keep official text handling separate and require the user to provide or confirm legally usable source data.

---

# 27. Suggested seed data for development

Use clearly fictional placeholder data.

## Species options

```json
[
  {
    "slug": "varsoster",
    "name": "Varsoster",
    "description": "Dense-bodied people adapted to Varkhul's old gravity and deep civic traditions.",
    "traits": [
      { "name": "Grounded Frame", "description": "Placeholder trait for development." },
      { "name": "Civic Memory", "description": "Placeholder trait for development." }
    ]
  },
  {
    "slug": "gnetunin",
    "name": "Gnetunin",
    "description": "Sea-kin navigators shaped by coastal life, endurance, and long memory.",
    "traits": [
      { "name": "Mariner's Breath", "description": "Placeholder trait for development." }
    ]
  }
]
```

## Class options

```json
[
  {
    "slug": "fighter",
    "name": "Fighter",
    "description": "A straightforward martial character suited for new players.",
    "complexity": "Low"
  },
  {
    "slug": "wizard",
    "name": "Wizard",
    "description": "A scholarly spellcaster with high flexibility and higher complexity.",
    "complexity": "High"
  }
]
```

## Background options

```json
[
  {
    "slug": "sanctum-apprentice",
    "name": "Sanctum Apprentice",
    "description": "You were trained near the formal structures of magical education and institutional secrecy."
  },
  {
    "slug": "harbor-factor",
    "name": "Harbor Factor",
    "description": "You understand contracts, cargo, rumors, and the quiet movement of power through trade."
  }
]
```

---

# 28. README requirements

Create a clear README with:

* Project description
* Stack
* Prerequisites
* Setup steps
* Supabase setup
* Environment variables
* Running Flutter app
* Running lore sync script
* Applying migrations
* Development workflow
* Security notes

Example README sections:

````markdown
# Chronicle & Character

## Requirements

- Flutter stable
- Dart
- Python 3.11+
- Supabase project

## Setup

1. Clone repository.
2. Copy `.env.example` to `.env`.
3. Configure Supabase URL and keys.
4. Apply migrations.
5. Install Flutter dependencies.
6. Run app.

## Run Flutter app

```bash
cd app
flutter pub get
flutter run -d chrome
````

## Run lore sync

```bash
cd tools
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python sync_lore.py
```

````

---

# 29. Coding standards

## General

- Keep code readable and explicit.
- Prefer small files over large monolithic files.
- Use typed models.
- Avoid business logic directly inside widgets when possible.
- Services should handle Supabase communication.
- Controllers/providers should handle UI state.
- Widgets should focus on display and input.

## Error handling

Every Supabase call should handle:

- Loading state
- Empty state
- Error state
- Permission error where relevant

## Naming

Use clear domain names:

- `LoreEntry`
- `Character`
- `Profile`
- `CharacterCreatorState`
- `LoreService`
- `CharacterService`
- `DmDashboardPage`

Avoid vague names like:

- `DataManager`
- `MainService`
- `StuffPage`

---

# 30. First Codex tasks

Use smaller tasks instead of asking Codex to build the full app in one step.

## Task 1 — Create scaffold

Prompt:

```text
Create the initial Flutter Web project structure for Chronicle & Character according to AGENTS.md. Add Riverpod, GoRouter, Supabase Flutter, and flutter_markdown. Implement a minimal app shell with auth-aware routing placeholders for login, register, lore list, character list, and DM dashboard. Do not implement business logic yet. Add a README with setup instructions.
````

## Task 2 — Add Supabase schema

Prompt:

```text
Add Supabase SQL migrations for the Chronicle & Character MVP. Include profiles, lore_entries, characters, timestamp triggers, handle_new_user trigger, is_dm helper function, and Row Level Security policies exactly matching the project rules. Do not add DM character update permissions. Add comments explaining each policy.
```

## Task 3 — Implement auth

Prompt:

```text
Implement Supabase Auth in Flutter. Add login, register, logout, auth state provider, profile loading, and route guards. New users should receive a profile row through the database trigger. DM routes should only be accessible to users whose profile role is dm. Add clear loading and error states.
```

## Task 4 — Implement lore reading

Prompt:

```text
Implement the lore feature. Add LoreEntry model, LoreService, lore list page, lore detail page, Markdown rendering, search by title/content, and tag/category display. Player accounts should only receive visible lore because of RLS. Do not bypass RLS in frontend code.
```

## Task 5 — Implement DM lore admin

Prompt:

```text
Implement the DM lore admin page. It should list all lore entries available to the DM, show title, slug, category, tags, and visibility state, and allow toggling is_visible. The page must be unavailable to player accounts through route guards and still rely on RLS for real security.
```

## Task 6 — Implement Obsidian sync

Prompt:

```text
Create tools/sync_lore.py and tools/requirements.txt. The script should read Markdown files from configured Obsidian directories, parse YAML frontmatter, validate title and slug, respect visible and player_safe fields, compute a source hash, convert simple Obsidian wikilinks to plain Markdown/text, and upsert rows into Supabase lore_entries by slug using a service role key from environment variables. Add a tools/README.md with usage instructions and safety notes.
```

## Task 7 — Implement character creator MVP

Prompt:

```text
Implement a Level 1 character creator MVP. Add Character and CharacterSheetData models, CharacterService, character list page, character sheet page, and a guided multi-step creator with concept, species, class, background, ability scores, skills, equipment notes, and review. Use placeholder seed options for species/classes/backgrounds. Players can create and edit only their own characters. DM can view all characters read-only.
```

## Task 8 — Add validation and tests

Prompt:

```text
Add validation and tests for the Chronicle & Character MVP. Cover model serialization, character creator state transitions, ability score assignment validation, and core service error handling where feasible. Add manual security test instructions for verifying RLS behavior with two player accounts and one DM account.
```

---

# 31. Acceptance criteria for MVP

The MVP is complete when:

* A user can register and log in.
* A profile is automatically created.
* A player can read visible lore.
* A player cannot read hidden lore.
* A DM can read all lore.
* A DM can toggle lore visibility.
* The sync script can import Obsidian Markdown notes.
* A player can create a Level 1 character.
* A player can edit their own character.
* A player cannot view or edit another player’s character.
* A DM can view all player characters read-only.
* The app can run locally in Chrome.
* The README explains setup clearly.

---

# 32. Development cautions

Do not overbuild.

The most likely failure mode is scope creep. The character creator can become enormous if treated like a full rules engine. Keep the first version narrow.

Do not build a general-purpose D&D rules platform. Build the smallest useful Varkhul campaign app.

Do not treat frontend route protection as security. Use RLS.

Do not expose hidden lore in frontend bundles, local JSON files, or cached data.

Do not put service role keys in Flutter.

Do not copy large official D&D text into seed files.

---

# 33. Final product direction

Chronicle & Character should feel like a private campaign archive and guided character desk.

The app should help new players answer:

* What is this world?
* What lore am I allowed to know?
* What kind of character fits this campaign?
* How do I build a character without being overwhelmed?
* What does my sheet mean?

The DM should be able to answer:

* What have I revealed?
* What is still hidden?
* Who has made a character?
* What does each player’s sheet look like?

Build for clarity first. Expand only after the MVP works.
