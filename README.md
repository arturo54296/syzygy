# Together

A shared calendar for two people to find time together and decide what to do.
It's a static site with no backend: the data lives in Firebase Firestore, and there is no login.

## Features
- Week / 3-day / day calendar. Drag to add, or tap an empty spot.
- **Free** and **Flexible** time for each person: Arturo is purple and Zosia is green, solid for free and light/striped for flexible. Time slots (morning, afternoon, evening, all day, or exact times), and events that repeat every week or every 2 weeks with an optional end date and per-date skip.
- **Matches**: the times when you're both free (solid pink) or both available with at least one of you only flexible (dashed pink). They're listed in the sidebar as "Next times you're both free".
- **Plans**: an empty event where you pick the activities you'd like to do (at least one, up to all of them). Each person votes separately, and the activities you both picked are marked ❤. You set a final choice (or press 🎲 Pick for us) and mark the plan Proposed or Confirmed.
- **Ideas list**: editable (add, edit, archive, delete, emoji), with tags for indoor/outdoor, cost, length, needs good weather and book ahead. Filters include ☔ "It's raining", "No booking", cost, length and search.
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
