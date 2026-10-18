# CAPTABLE: cap table, dilution and deal calculator

A plain HTML + CSS + JavaScript website. No build step, no framework. Firebase (Google sign-in + Firestore) stores the data.
See **SETUP.md** to connect Firebase. Until then it runs in Demo mode, saving in your browser.

## Screens (one HTML file each)

| File | Screen |
|---|---|
| `index.html` | Sign in with Google |
| `home.html` | Your startups: tiles with last updated time, Create startup, Delete (type the name to confirm) |
| `dashboard.html` | The one live dashboard: setup, funding deal, other changes, cap table, waiting deals, money view, sticky Save / Accept bar |
| `archive.html` | Full history, calendar with a count on every day, cap table on any date, Undo and Restore |
| `report.html` | Printable cap table report as of any date (Print or Save as PDF) |
| `quickcalc.html` | Quick "what does this offer cost me?" in percentages. Public, saves nothing |

## Folders

* `css/style.css`: the whole light theme.
* `js/config.js`: **your Firebase settings go here.**
* `js/engine.js`: all the maths (exact fractions, so rounding down to a whole share is exact). No screen code.
* `js/ledger.js`: turns actions into events with a plain-English summary.
* `js/backend.js`: Google sign-in and saving (Firebase, or the browser-only demo).
* `js/dialogs.js`, `js/dash-render.js`, `js/page-*.js`: the screens.
* `firestore.rules`, `firebase.json`: security rules and hosting settings.

## How the money maths works

* **No auto-align to whole shares.** Price per share = pre-money ÷ shares before the money. New shares = the offered amount ÷ price, **rounded down**. The investor pays shares × price, and the leftover is **settled in cash**.
  Example: ₹10,00,000 for 10% of a 1,000-share company is ₹9,000 a share, 111.11 shares. They get **111 shares (09.99%)** and the remaining 0.11 of a share is settled in cash: **₹1,000**. The clause is shown live while you type.
* **Ownership is always shown as `00.00%`** (09.99%, 90.01%, 100.00%).
* **An investor can hold at most 99%.** 100% is a buy-out: transfer the shares instead.
* **Setup is two-of-three:** authorised capital, authorised shares and face value. Change any two, the third is worked out.
* **The setup locks** once the cap table has any history beyond incorporation. Name and DPIIT status stay editable. Undo the history in the Archive to unlock.
* **Accept is blocked** if a deal needs more shares than are authorised. A button offers the Form SH-7 increase.
* **Waiting deals** (iSAFE, convertible note) are not shares until a priced round, or you convert them. The dashboard previews what each would become at an assumed next round.

## Decisions to know about

* US-style pre-money and post-money SAFEs are not offered as separate types. The **iSAFE** (post-money cap, four types) and the **Indian convertible note** (pre-money cap) cover them.
* The clause registry and "delete account" are not in this build.
* CAPTABLE is a calculation aid. It is not legal, tax or financial advice.
