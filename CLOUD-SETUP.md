# Switching on TRC logins and cloud sync (free Supabase project)

TRC works without this: everything stays on each device. Doing these steps once lets people create a TRC login and sync between
devices. It takes about 15 minutes and costs nothing on Supabase's free plan. Nobody else can do steps 1-5 for you, because they
create an account in your name.

## What the free plan gives you (checked 2 Nov 2026, supabase.com/pricing)
| | Free plan |
|---|---|
| People who can sign in per month | 50,000 |
| Database size (everyone together) | 500 MB |
| Projects | 2 active |
| Backups | **None** - people must keep downloading their own backups (TRC reminds them) |
| Inactivity | **The project pauses after 7 days with no activity.** Sign-ins and syncs count as activity. If it pauses, open the Supabase dashboard and press Resume (kept up to a year). While paused, TRC keeps working on each device and syncs again once resumed. |
| Sign-in emails | Supabase's built-in sender only allows a few emails per hour. Fine for you and a few testers; for real users add a free email sender (step 6). |
| Paid plan if ever needed | Pro, from $25/month. Nothing is ever charged unless you add a card and upgrade yourself. |

**Rough capacity:** a trade is about 1-2 KB in the database. With 500 MB, that is very roughly 250,000-400,000 trades in total, for
example about 250 people with 1,000 trades each. TRC limits each login to 50,000 items and 50 MB so one account cannot fill it.
Screenshots are not uploaded (they stay on each device and in backup files).

## 1. Create the project
1. Go to https://supabase.com and sign up (free; "Continue with GitHub" works).
2. **New project** - name it `trc`, choose the region closest to you, set a **database password** (keep it to yourself; TRC does
   not need it), plan **Free**. Wait until it says the project is ready.

## 2. Create TRC's tables and rules
1. In the project, open **SQL Editor** > **New query**.
2. Open `cloud/supabase.sql` from this repository, copy all of it, paste it in, press **Run**. It should say "Success. No rows returned".
   (Running it again later is safe.)

## 3. Sign-in settings
In **Authentication**:
1. **Sign In / Providers > Email**: Email provider **on**, **Confirm email on**, **Secure email change on**. Set the minimum
   password length to **8** if the option is shown.
2. **URL Configuration**:
   - **Site URL**: your TRC address, e.g. `https://tombszwillmakemore.github.io/Tamhas-Risk-Calculator/`
   - **Redirect URLs**: add `https://tombszwillmakemore.github.io/Tamhas-Risk-Calculator/**`
   (Use your own domain instead if TRC is served from one.)
3. Leave rate limits, CAPTCHA and other settings at their defaults.

## 4. Copy the two PUBLIC values
**Project Settings > API** (on newer dashboards: **API Keys** and **Data API**):
- **Project URL** - looks like `https://abcdefgh.supabase.co`
- **anon public** key (or **publishable** key, starts with `sb_publishable_`)

Both are meant to sit inside a website. Your data is protected by the rules from step 2, not by hiding these.
**Never copy the `service_role` / `secret` key anywhere** - not into TRC, not into GitHub, not into a message.

## 5. Put them into TRC
Edit `assets/cloud-config.js` on the `dev-free-platform` branch:
```js
window.TT_CLOUD = window.TT_CLOUD || { url: 'https://abcdefgh.supabase.co', anonKey: 'PASTE-THE-ANON-OR-PUBLISHABLE-KEY' };
```
(or send the two values to Claude and ask it to do this step). The automated check refuses a service-role or secret key.

## 6. (Before inviting other people) a free email sender
Supabase's built-in sender is only for testing. In **Authentication > Emails > SMTP Settings**, enable custom SMTP with a transactional
email service that has a free plan (for example Resend or Brevo - check their current free limits). You need a domain you can verify
with them. Then raise the email rate limit under **Authentication > Rate Limits**.

## 7. (Optional) let GitHub test against the real project
TRC's GitHub Actions check (free for public repositories) runs `tests/cloudlive.js` against the real project when these
**repository secrets** exist (GitHub > Settings > Secrets and variables > Actions > New repository secret):

| Secret | Value |
|---|---|
| `TRC_LIVE_URL` | the Project URL |
| `TRC_LIVE_ANON` | the anon / publishable key |
| `TRC_LIVE_A_EMAIL`, `TRC_LIVE_A_PASSWORD` | a TEST login you created in TRC and confirmed (its cloud data is wiped by the test) |
| `TRC_LIVE_B_EMAIL`, `TRC_LIVE_B_PASSWORD` | a second TEST login |

Secrets are never shown in logs or in the repository. Use test logins only, never your real one.

## What has been verified, and what still needs the real project
- **Verified here:** the SQL (`cloud/supabase.sql`) on a real PostgreSQL 16 with Supabase's roles and `auth.uid()` (tests/cloudsql.js,
  41 checks: isolation between people, anonymous lockout, no direct writes, conflicts, tombstones, quotas, late commits, deletion);
  the sync engine (tests/synccore.js); and the whole app in real browsers against a local Supabase stand-in that runs that same SQL
  (tests/cloud1e2e.js: sign-up, email links, two devices, offline, conflicts, migration, switching people, export, password reset,
  magic link, sign out everywhere, account deletion).
- **Not verified until the project exists:** Supabase's own email delivery and link format, its rate limits, its token contents (the
  "recent sign-in" check reads the token's `amr` claim), and real phones. After step 5, sign up yourself on two devices and check that
  a trade added on one appears on the other; step 7 then re-checks the server rules automatically on every push.
