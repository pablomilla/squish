# Squish privacy policy

**Last updated: 22 September 2026**

Squish is a food diary. This explains what it keeps, where it goes, and how to
get rid of it. It is written to be read rather than to be defensible, and it
says the uncomfortable parts too.

Throughout, "we" means whoever runs this copy of Squish — the person whose
contact address is at the bottom.

---

## The short version

- Your diary lives on your device. A copy is kept on our server so you can get
  it back if you lose the device.
- Meal photos are part of that copy.
- Photos, meal descriptions and anything you say to the nutritionist are sent
  to Anthropic, who run the AI that reads them.
- We do not use analytics, advertising, or trackers of any kind, and we do not
  sell or share your data with anyone not named here.
- You can export everything, and you can delete everything, from inside the
  app.

---

## What Squish holds about you

### On your device, always

This is kept in your browser's storage and never leaves it unless you turn on
an account or a backup.

| What | Examples |
|---|---|
| Your profile | The name you typed, if any; sex, age, height, weight, target weight, activity level, goal, and units |
| Your meals | Titles, foods, portions, nutrition figures, your notes, and **the photos you took** |
| Your days | Water, weight entries, and the day's totals |
| Your settings | Saved foods, achievements earned, colourway, light or dark, reminder times |
| Nutritionist notes | Anything the nutritionist wrote down because you told it — an allergy, a food you avoid, what you are training for |

### On our server, if you use the backup or an account

Backup is on by default where this copy of Squish has a database.

- **Everything in the table above, including your meal photos.** It is stored
  as one document per person, updated as you log.
- **A device identifier** — a random token your browser is given on first use,
  stored in a form we cannot reverse, plus when it was created and last seen.
  It is how a daily limit can be counted per phone rather than per network.
- **How many photos, chats and recipes you have used today.** Counts only.
- **If you make an account:** your email address, and your password stored as
  a scrypt hash. We never store the password itself and cannot read it.
- **If you ask to reset a password:** a hashed, single-use token that expires
  after two hours.

### What we do not hold

No analytics. No advertising identifiers. No third-party trackers. No
behavioural profiling. No location data. No contacts, no calendar, no
microphone recordings — voice logging happens in your browser and only the
resulting text reaches us. We do not log your requests; the server writes to
its log only when something fails, and those entries do not contain your diary.

---

## Health data, and why it needs your consent

A food diary, your weight, and your health goals are **special category data**
under UK and EU data protection law. That is the strictest tier, and it is
lawful for us to hold it only with your **explicit consent**.

Using Squish is that consent, and you can withdraw it at any time by deleting
your account or resetting the app — both from inside the app, both immediate.
Withdrawing does not undo processing that already happened, but it does remove
what we hold.

For everything else — your email address, the device token, the usage counts —
our lawful basis is legitimate interest: running the service, and keeping one
person from spending everyone else's allowance.

---

## Who else sees it

Three companies process data on our behalf. We have no other recipients, and we
do not sell data to anybody.

### Anthropic — the AI

Sent to Anthropic's Claude API, and only when you do one of these things:

| When you | What is sent |
|---|---|
| Photograph a meal | The photo |
| Describe a meal in words or by voice | What you wrote or said |
| Import a recipe from a link | The text of that page |
| Ask the nutritionist something | Your message, and whatever it looks up from your diary to answer you — meals, totals, trends, and any notes it has kept |

Anthropic process it to produce the answer and return it. Their handling is
governed by their own terms and privacy policy, at
[anthropic.com/legal/privacy](https://www.anthropic.com/legal/privacy).

The nutritionist is the one to be aware of: answering "am I getting enough
protein?" means sending a slice of your diary along with the question.

### Open Food Facts — barcodes

When you scan a barcode, the number alone goes to
[world.openfoodfacts.org](https://world.openfoodfacts.org) to look up the
product. Nothing about you goes with it. Scanning the same barcode twice does
not ask them twice.

### Our host

The server and its database run on Render. They hold the data on our behalf and
do not use it for anything else.

### Recipe links

When you paste a recipe link, our server fetches that page. The site you linked
to sees a request from our server, not from you — your address is not passed on.

---

## How long it is kept

- **Your diary backup:** until you delete it. Deleting your account or pressing
  Reset removes it immediately.
- **Your account:** until you delete it.
- **Device records and usage counts:** device records persist while the device
  is in use. Usage counts are per day and are of no interest after it.
- **Reset tokens:** two hours, or until used, whichever comes first.
- **Failure logs:** kept by our host for a short period as part of ordinary
  operations. They do not contain your diary.

Deleting your account removes the copy on the server. **It does not remove the
diary on your device** — that is yours and stays put. Reset, on the You screen,
is what clears the device, and it deletes the server copy too.

---

## What you can do

All of this is in the app, on the **You** screen. None of it requires emailing
anybody.

| Right | How |
|---|---|
| See what we hold | **Export JSON** — the complete diary, as a file |
| Take it elsewhere | The same export is a plain, readable format |
| Delete your account and the server copy | **Delete account** |
| Delete everything, device included | **Reset** |
| Correct something | Edit or delete any meal, any time |
| Withdraw consent | Delete your account, or Reset |

If you want any of this done for you, or you are not satisfied with how we have
handled a request, write to the address below. You also have the right to
complain to the Information Commissioner's Office at
[ico.org.uk](https://ico.org.uk).

---

## Security

- Passwords are hashed with scrypt. We cannot read them, and neither can anyone
  who obtains the database.
- Device tokens and reset tokens are stored hashed for the same reason.
- Traffic is encrypted in transit.
- A wrong password and an unknown email address produce the same answer, so the
  app cannot be used to find out who has an account.
- Sign-in attempts are rate limited per device.

No system is perfect, and Squish is a small one. If you find a security problem,
please tell us at the address below rather than anywhere else first.

---

## Age

Squish is not intended for under-18s. It shows calorie figures and diet
feedback, and that is not something to put in front of children without more
care than a food diary can take. Please do not use it if you are under 18.

---

## Changes

If this policy changes in a way that affects what we do with your data, the app
will say so rather than quietly swapping the page. The date at the top is when
it last changed.

---

## Contact

<!--
  TODO before publishing: put a real contact address here.

  Use one you are willing to have on a public page and in an app store
  listing — a dedicated address rather than your personal inbox is the usual
  advice. Both stores also require a policy URL, and the ICO expects a
  contact route for data requests.
-->

**Email:** `[your contact address]`

**Data controller:** `[your name or company name]`
