# Syzygy

A shared calendar for two people, for when your free times align (a syzygy is when planets line up), to find time together and decide what to do.
It's a static site with no backend: the data lives in Firebase Firestore, and there is no login.

## Features
- Week / 3-day / day calendar. Drag on an empty spot to add (or tap it). Drag a plan or a free/flexible block to move it to another time or day, or drag its bottom edge to change when it ends (phone: hold, then drag).
- **Free** and **Flexible** time for each person: Arturo is purple and Zosia is green, solid for free and light/striped for flexible. Time slots (morning, afternoon, evening, all day, or exact times), and events that repeat every week or every 2 weeks with an optional end date and per-date skip.
- **Approximate times**: unless you tick **Exact time**, an event's times are approximate: they show as "~16:00–19:00" and a colour gradient spreads above and below the block (1.5 h for plans, 0.5 h for free/flexible time) and a little to the sides.
- **Matches**: the times when you're both free (solid pink) or both available with at least one of you only flexible (dashed pink). They're listed in the sidebar as "Next times you're both free".
- **Plans**: an empty event where you pick the activities you'd like to do (at least one, up to all of them). Each person votes separately, and the activities you both picked are marked ☌. You set a final choice (or press 🎲 Pick for us) and mark the plan Proposed or Confirmed.
- **Ideas list**: editable (add, edit, archive, delete, emoji), with tags for indoor/outdoor, cost, length, needs good weather and book ahead. Filters include ☔ "It's raining", "No booking", cost, length and search.
- **Fixed-time ideas**: an idea can have a fixed time (e.g. 🛏️ Sleeping together = 21:00–09:00 next day). Picking or dragging it sets the plan to that time.
- **Drag an idea** from the list onto the calendar to plan it there, or onto a plan to add it to your votes. On a phone: hold the idea, then drag.
- 🎲 **Surprise us**: a random idea from the filtered list, with a button to plan it at your next shared free time.
- 📊 **Stats**: how many times you've done each activity and when you last did it, plus the ideas you haven't tried yet.

## The secret link
The app only opens with the full link, which ends in `#k=<key>`, or on a device that has opened that link before (each device remembers the key). Without a key, or with a wrong one, the whole page is replaced by a "Ask Arturo for the link" message, and nothing is read or created. Creating a new calendar is switched off (`ALLOW_NEW_CALENDAR` in `app.js`): there is only one shared calendar.

## Run locally (demo mode)
While `config.js` has `firebaseConfig = null`, everything is saved in this browser only, and two tabs stay in sync.
```bash
python3 -m http.server 5810
```
Then open http://localhost:5810.

## Set up Firebase (once, free)
1. Go to https://console.firebase.google.com, choose **Add project**, give it a neutral name, and skip Analytics.
2. Open **Build → Firestore Database → Create database**, then pick a location (e.g. `europe-west3`) and **production mode**.
3. In the **Rules** tab, paste in the contents of `firestore.rules` and click **Publish**.
4. Go to **Project settings (⚙) → Your apps → Web (</>)**, register an app (no hosting), copy the `firebaseConfig` object into `config.js`, and remove the `null`.

The config values are public by design. What protects the data is the long random key in your link: nobody can list the spaces, and the rules only let a request through when it carries a valid key.

## Deploy on Render (free static site)
1. Push this folder to a **private** GitHub repo.
2. On https://render.com, choose **New → Static Site**, connect the repo, leave the **Build command** empty and set the **Publish directory** to `.`. Alternatively, use **New → Blueprint**, which reads `render.yaml`.
3. Open `https://….onrender.com/#new` and click **Create a new calendar**. Copy the link it shows (it ends in `#k=…`) and send it to the other person. Both of you bookmark it.

Every push to the repo redeploys the site. Your data is unaffected, because it lives in Firebase.

## Google Calendar sync (optional)
Every plan, proposed or confirmed, is copied to **one shared Google calendar called "Syzygy"**, so it shows up in both of your Google Calendars. Proposed plans get "(proposed)" in the title and don't block your time. Each person can also see their own Google busy times in the app, as grey blocks only they can see. There's no server: the browser signs in to Google and syncs while the app is open on a connected device. Edit plans in the app, not in Google Calendar.

### What Syzygy can access in your Google account
As little as possible, so that even a hacked copy of the code couldn't do much:
- `calendar.app.created`: create its own "Syzygy" calendar and edit events **only in calendars Syzygy created**. Your main calendar and every calendar you made yourself are refused by Google.
- `calendar.freebusy`: your busy times (e.g. "busy 10:00–11:00"), never titles, people or places.
- `openid email`: your email address, so Google can skip "choose an account" when the sign-in is renewed.

Worst case if someone changed the code: they could see when you're busy and mess up the Syzygy calendar. No Gmail, no Drive, no other calendars. Tested with two accounts on 23/11/2026: the second account could write to the Syzygy calendar the first one created and shared, and reading the main calendar was refused.

Earlier versions asked for full access to all calendars. When a device opens this version, Syzygy removes that old access once (per Google account) and asks you to approve the small set above. **Rule of thumb:** after that, Syzygy should never show an approval screen again. If Google ever asks you to approve something new (e.g. email or Drive), close it and don't approve.

### Setup (once, about 10 min)
You can reuse the Firebase project, which is also a Google Cloud project:
1. In https://console.cloud.google.com, select the project. Go to **APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.
2. Go to **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) and choose **External**. Fill in an app name and the email fields. Under **Audience → Test users**, add both of your Google emails. Under **Data access**, add the three scopes above.
3. Go to **Credentials → Create credentials → OAuth client ID** and choose type **Web application**. Under **Authorized JavaScript origins**, add the site URL (e.g. `https://syzygy-9i5i.onrender.com`) and `http://localhost:5810`. You don't need redirect URIs.
4. Copy the **Client ID** (`…apps.googleusercontent.com`) into `googleClientId` in `config.js`, then push.
5. In the app, click 📅, then **Connect Google Calendar**. Google shows an "unverified app" warning: click **Continue**.
6. One of you clicks **Create the Syzygy calendar**. Then, in Google Calendar: **Settings → "Syzygy" → Share with specific people**, add the other person with **Make changes to events**. They accept Google's email and click **Connect** in the app on their device; the calendar is already set for both.

Google's sign-in lasts about an hour. Saving a plan renews it (a small window may flash and close by itself); otherwise the 📅 button says **Reconnect**.
