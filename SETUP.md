# Connect CAPTABLE to your Firebase (Firestore + Google sign-in)

You do **not** download any file from Firebase for the website. There is no `google-services.json` here
(that one is only for the Android app) and no service-account key. Instead you **copy 6 values** from the
Firebase console and **paste them into one file: `js/config.js`**. That is the whole connection.

## 0. Try it first, with no Firebase at all

Until `js/config.js` is filled in, the site runs in **Demo mode** (a yellow "Demo mode" badge shows in the top bar).
Sign-in is simulated and everything is saved only in your browser. Every screen works.

The site must be opened through a web address. Double-clicking `index.html` will NOT work, because browsers block
the scripts on `file://` pages. Open a terminal in this folder and run one of:

```
python3 -m http.server 8000        (Mac / Linux)
python -m http.server 8000         (Windows)
npx serve .                        (if you have Node)
```

Then open **http://localhost:8000**. (VS Code's "Live Server" extension works too.)

## 1. Create or pick the Firebase project

1. Go to https://console.firebase.google.com and open the project you already use for CAPTABLE (or **Add project**).
2. The same project can serve the website and the Android app.

## 2. Register a web app and copy its config  (this is the "file" step)

1. Click the **gear icon → Project settings → General**.
2. Scroll to **Your apps** and click the **`</>` (Web)** icon.
3. App nickname: `CAPTABLE web`. Leave "Firebase Hosting" unticked for now. Click **Register app**.
4. Firebase shows a block like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza....",
     authDomain: "my-project.firebaseapp.com",
     projectId: "my-project",
     storageBucket: "my-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```
5. Open **`js/config.js`** in this folder and replace the `PASTE_...` values with those six values.
   Keep the quotes. Save the file.

> The API key in a web app is **not a secret**. It only names your project. What protects your data is the
> Firestore rules in step 5.

## 3. Turn on Google sign-in

1. Firebase console → **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on → pick a support email → **Save**.
3. **Settings** tab → **Authorized domains**. `localhost` is already there. When you put the site online, add its
   domain here (a `*.web.app` / `*.firebaseapp.com` Hosting domain is added for you).

## 4. Create the Firestore database (skip if you already have one)

1. **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)** is closest for India. Start in **production mode**.

## 5. Publish the security rules

1. **Firestore Database → Rules** tab.
2. Replace the text with the contents of **`firestore.rules`** from this folder, then click **Publish**.

The rules let each signed-in person read and write only `users/{their own uid}/...` and nothing else.
If your Android app still needs other collections, add their `match` blocks to the rules instead of deleting them.

## 6. Test it

1. Run the local server again (step 0) and open http://localhost:8000.
2. The "Demo mode" badge should be gone. Click **Continue with Google**.
3. Create a startup. In the console open **Firestore Database → Data**: you will see
   `users → (your uid) → startups → (id)` and, inside it, an `events` collection with one document per change.

## 7. Put it online (Firebase Hosting)

```
npm install -g firebase-tools
firebase login
firebase use --add            # choose your project
firebase deploy               # publishes the site and the rules
```

`firebase.json` is already set up (public folder = this folder). Your site will be at
`https://YOUR-PROJECT.web.app`. Any other static host (Netlify, GitHub Pages, your own server) also works:
upload this whole folder and add the domain under **Authentication → Settings → Authorized domains**.

## What is stored

| Path | Holds |
|---|---|
| `users/{uid}/startups/{startupId}` | name, last-updated time, a small summary for the home tiles |
| `users/{uid}/startups/{startupId}/events/{eventId}` | one document per change (incorporation, priced round, transfer, split ...) |

The cap table is never stored as a table. It is rebuilt from the events every time, which is what makes the
Archive, time travel and Undo possible. "Undo" only stamps an event as undone. Nothing is erased
except when you delete a whole startup.

## If something goes wrong

| You see | Fix |
|---|---|
| Blank page / scripts blocked | You opened the file directly. Use a local server (step 0). |
| "This website address is not allowed yet" (`auth/unauthorized-domain`) | Add the domain under Authentication → Settings → Authorized domains. |
| "Google sign-in is switched off" (`auth/operation-not-allowed`) | Step 3: enable the Google provider. |
| `permission-denied` on the home screen | Publish the rules (step 5) and make sure you are signed in. |
| "Could not connect to Firebase" | Check the values in `js/config.js` and your internet connection. |
| Sign-in popup does nothing | Allow pop-ups for the site. The app then falls back to a full-page redirect. |
