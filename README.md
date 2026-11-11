# Together

A shared calendar for two people to find time together and decide what to do.
It's a static site with no backend: the data lives in Firebase Firestore, and there is no login.

## Features
- Week / 3-day / day calendar. Drag on an empty spot to add (or tap it). Drag a plan or a free/flexible block to move it to another time or day, or drag its bottom edge to change when it ends (phone: hold, then drag).
- **Free** and **Flexible** time for each person: Arturo is purple and Zosia is green, solid for free and light/striped for flexible. Time slots (morning, afternoon, evening, all day, or exact times), and events that repeat every week or every 2 weeks with an optional end date and per-date skip.
- **Approximate times**: unless you tick **Exact time**, an event's times are approximate: they show as "~16:00–19:00" and the block has soft, fuzzy edges.
- **Matches**: the times when you're both free (solid pink) or both available with at least one of you only flexible (dashed pink). They're listed in the sidebar as "Next times you're both free".
- **Plans**: an empty event where you pick the activities you'd like to do (at least one, up to all of them). Each person votes separately, and the activities you both picked are marked ❤. You set a final choice (or press 🎲 Pick for us) and mark the plan Proposed or Confirmed.
- **Ideas list**: editable (add, edit, archive, delete, emoji), with tags for indoor/outdoor, cost, length, needs good weather and book ahead. Filters include ☔ "It's raining", "No booking", cost, length and search.
- **Fixed-time ideas**: an idea can have a fixed time (e.g. 🛏️ Sleeping together = 21:00–09:00 next day). Picking or dragging it sets the plan to that time.
- **Drag an idea** from the list onto the calendar to plan it there, or onto a plan to add it to your votes. On a phone: hold the idea, then drag.
- 🎲 **Surprise us**: a random idea from the filtered list, with a button to plan it at your next shared free time.
- 📊 **Stats**: how many times you've done each activity and when you last did it, plus the ideas you haven't tried yet.

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
3. Open the `….onrender.com` URL and click **Create our shared calendar**. Copy the link it shows (it ends in `#k=…`) and send it to the other person. Both of you bookmark it.

Every push to the repo redeploys the site. Your data is unaffected, because it lives in Firebase.

## Google Calendar sync (optional)
Every plan, proposed or confirmed, is copied to **one shared Google calendar**, so it shows up in both of your Google Calendars. Proposed plans get "(proposed)" in the title and don't block your time. Each person can also see their own Google busy times in the app, as grey blocks only they can see. There's no server: the browser signs in to Google and syncs while the app is open on a connected device. Edit plans in the app, not in Google Calendar.

Setup (once, about 10 min). You can reuse the Firebase project, which is also a Google Cloud project:
1. In https://console.cloud.google.com, select the project. Go to **APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.
2. Go to **APIs & Services → OAuth consent screen** (or **Google Auth Platform**) and choose **External**. Fill in an app name and the email fields. Under **Audience → Test users**, add both of your Google emails. Leave it in **Testing**.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose type **Web application**. Under **Authorized JavaScript origins**, add the site URL (e.g. `https://syzygy-9i5i.onrender.com`) and `http://localhost:5810`. You don't need redirect URIs.
4. Copy the **Client ID** (`…apps.googleusercontent.com`) into `googleClientId` in `config.js`, then push.
5. In Google Calendar, create a calendar (e.g. "Us") and share it with the other person, giving them **Make changes to events**.
6. In the app, click 📅, then **Connect Google Calendar**. Google shows an "unverified app" warning: click **Continue**. Then click **Choose calendar** and pick "Us". The other person only needs to click **Connect** on their device; the calendar choice is shared.

Google's sign-in lasts about an hour. When it has run out, the 📅 button says **Reconnect**. Saving a plan reconnects automatically, which may show a quick popup.
