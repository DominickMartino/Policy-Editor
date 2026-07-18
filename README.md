# Martino Medical — Policy Editor

This is the deployable version of the policy editor tool. Same design and
behavior as the prototype, but restructured so your Anthropic API key stays
private on a server instead of living in the browser.

## What's in here

- `src/App.jsx` — the app itself (identical design/behavior to what you tested)
- `api/rewrite.js` — a small serverless function that holds your API key and
  talks to Anthropic on the app's behalf
- Everything else is standard Vite/React project scaffolding

## One-time setup (about 20–30 minutes)

### 1. Get an Anthropic API key
- Go to https://console.anthropic.com
- Sign up / log in
- Go to "API Keys" and create a new key
- Add a small amount of credit (a few dollars will last a long time — each
  rewrite costs a fraction of a cent)
- Copy the key somewhere safe. You will NOT put this in any code file.

### 2. Push this project to GitHub
- Create a free GitHub account if you don't have one (github.com)
- Create a new repository (e.g. "martino-medical-policy-editor")
- Upload this whole folder to that repository (GitHub's website lets you drag
  and drop files if you don't want to use git commands)

### 3. Set up login (Clerk)
This adds real sign-in, so you and Erin each get your own private, separate
list of saved policies.
- Go to https://clerk.com and sign up (free tier easily covers 2 users)
- Create a new application. When asked which sign-in methods to enable,
  choose **"Email link"** (sometimes called "magic link") — this means
  typing an email and clicking a link, no password to create or remember
- In your Clerk dashboard, go to **Configure → Restrictions**, and set
  sign-ups to **restricted**, then add your email and Erin's email to the
  allowlist. This stops anyone else from creating an account.
- In the Clerk dashboard, find your **Publishable Key** and **Secret Key**
  (under API Keys). You'll need both in the next step.

### 4. Add persistent storage
Before deploying, connect a Redis database so saved policies aren't lost
between visits:
- In your Vercel project dashboard, go to the "Storage" tab
- Click "Create Database" / "Browse Marketplace" and add a Redis database
  (Upstash or Redis Cloud both work fine)
- Once created, you'll get a connection string that looks like:
  `redis://default:somepassword@somehost.redis.io:12629`
- Go to Settings → Environment Variables in your Vercel project, click
  "Add Environment Variable", and add:
  - Name: `REDIS_URL`
  - Value: (paste the full connection string, starting with `redis://`)
- Keep this value private — it's effectively a password to your saved data.
  Don't post it anywhere public.

### 5. Deploy on Vercel
- Go to https://vercel.com and sign up (free tier is enough for this)
- Click "Add New Project"
- Select the GitHub repository you just created
- Vercel will auto-detect this as a Vite project — leave the default settings
- Before deploying, go to "Environment Variables" and add all three:
  - Name: `ANTHROPIC_API_KEY` — Value: (the key from step 1)
  - Name: `VITE_CLERK_PUBLISHABLE_KEY` — Value: (the Publishable Key from step 3)
  - Name: `CLERK_SECRET_KEY` — Value: (the Secret Key from step 3)
- Click Deploy

### 6. You're live
- Vercel gives you a URL like `martino-medical-policy-editor.vercel.app`
- Open it — you'll now see a sign-in screen first
- Sign in with your email (you'll get a link in your inbox to click)
- Every policy you start is saved automatically, private to your account —
  Erin signs in with her own email and sees only her own policies
- You can add a custom domain later under Project Settings → Domains

## Testing locally first (optional, for the technically curious)

If you want to try it on your own computer before deploying:

```bash
npm install
npm run dev
```

Note: the AI calls won't work in local dev unless you also run
`vercel dev` (which loads the serverless function and environment variable
locally) instead of `npm run dev`. For your first deploy, it's simplest to
just push to Vercel directly and test on the live URL.

## Sending this to Erin

Once deployed, send her the Vercel URL and let her know she'll sign in with
her own email (using the same "email link" method — she'll get a link in
her inbox, no password). Make sure her email is on the allowlist from step 3,
or she won't be able to sign up.

## Adding it to a phone's home screen (turns it into an "app")

This project is set up so it can be added to a phone's home screen and opens
full-screen, without browser address bars — no App Store needed.

**On iPhone (Safari):**
1. Open your live URL in Safari (must be Safari, not Chrome, for this to work on iOS)
2. Tap the Share icon (square with an arrow pointing up)
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" — you'll now have an app icon on your home screen

**On Android (Chrome):**
1. Open your live URL in Chrome
2. Tap the three-dot menu, top right
3. Tap "Add to Home screen" (or "Install app" if it appears)
4. Confirm — same result, an app icon on the home screen

Do this yourself first to make sure the icon looks right, then you can tell
Erin (or any practice) to do the same 4-tap process on their own phone.

