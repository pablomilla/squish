# Squish privacy policy

**Last updated: 1 October 2026**

Squish is a food diary. This explains what it keeps, where it goes, and how to
get rid of it. It is written to be read rather than to be defensible, and it
says the uncomfortable parts too.

Throughout, "we" means whoever runs this copy of Squish — the person whose
contact address is at the bottom.

---

## The short version

- Your diary lives on your device. A copy is kept on our server so you can get
  it back if you lose the device, and so every device you sign in on has it
  and they keep each other up to date.
- A small version of each meal photo is part of that copy; the full photo
  stays on the device that took it.
- Photos, meal descriptions and anything you say to the nutritionist are sent
  to an AI company to be read: Anthropic, whose Claude reads most of them, or
  Google, whose Gemini we use for some of the work and as a backup when Claude
  cannot answer.
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
| Your profile | The name you typed, if any; sex, date of birth (or the age you typed instead), height, weight, target weight, activity level, goal, and units; and, if you answered when setting up, how you eat (a diet, allergies, foods you never eat), what you want from Squish and what you find gets in the way |
| Your meals | Titles, foods, portions, nutrition figures, and your notes — including meals you have planned for later, recipes you have saved, what happened to the meals the nutritionist planned (made, skipped or swapped), and your shopping list |
| Your photos | **The meal photographs themselves, which stay here.** Only a thumbnail of each — a few kilobytes — is part of the backup below |
| Your days | Water, weight entries, and the day's totals |
| Your settings | Saved foods, achievements earned, colourway, light or dark, reminder times |
| Nutritionist notes | Anything the nutritionist wrote down because you told it — an allergy, a food you avoid, what you are training for |
| Past chats with the nutritionist | **What you asked and what it answered, which stay here** unless you choose to back them up (below). The newest 30, none older than 90 days |

### On our server, if you use the backup or an account

Backup is on by default where this copy of Squish has a database.

- **Everything in the table above except the photographs**, which stay on your
  device, **and past chats**, unless you choose to back them up (below). What
  is backed up of a photograph is a thumbnail — roughly five kilobytes,
  the small square you see in the diary list. It is stored as one document per
  person, updated as you log.

  This means a new phone, or any other device you sign in on, has your diary
  and those thumbnails, but not the full pictures: those were never sent. If
  that matters to you, export before you change phones.

  With more than one device signed in, each one checks this copy when you
  open Squish and every few minutes while it is open, and takes in what the
  others have changed. When two have changed things at the same time, the
  changes are put together on your device, not on our server: a meal logged
  on each is two meals, the same one changed on both keeps the later change,
  and something deleted on one is deleted on the others. To do that, the
  copy also holds when each part of your diary last changed — times, nothing
  more. A device that signs in holding a diary of its own is never mixed
  with yours without asking: it might be somebody else's.
- **Your past chats with the nutritionist, only if you turn on "Backed up"**
  in the list of past chats. They are off unless you do: a chat can say a lot
  about your health. Backed up, they go in the same document as your diary
  (the newest first, up to about half a megabyte of them) and come back when
  you restore it or sign in on another phone. Turn it off and they leave the
  backup the next time it saves.
- **Which past chats you have deleted** — their random ids and when, nothing
  of what was in them — so a chat you delete on one device is deleted on your
  other devices too, and never comes back from one that still had it. Kept
  for four months, longer than any chat is.
- **A device identifier** — a random token your browser is given on first use,
  stored in a form we cannot reverse, plus when it was created and last seen,
  and which days it was used — a date, not what was done. It is how a limit
  can be counted per phone rather than per network, and how we know how many
  people use Squish each day.
- **How many photos, chats and recipes you have used today.** Counts only.
- **If you make an account:** your email address, and your password stored as
  a scrypt hash. We never store the password itself and cannot read it.
- **If you sign in with Google or Apple:** the id Google or Apple gives your
  account there, linked to your Squish account so the same button signs you
  in next time. From them we receive that id and your email address — with
  Apple, the private relay address if you chose to hide yours — and nothing
  else: not your name, contacts, photos or anything else in your Google or
  Apple account. See "Google and Apple — signing in" below.
- **How you heard about Squish**, if you answered when setting up: one choice
  from a fixed list (a friend, TikTok, a podcast…), kept against your device.
  We count the answers to learn which ways in bring people who stay; nothing
  about who told you is asked or kept.
- **If you ask to reset a password:** a hashed, single-use token that expires
  after two hours.
- **Whether you have confirmed your email address**, and, until you do, a
  hashed confirmation link that expires after a week.
- **If you change your email address** (or ask us to change it for you): the
  new address and a hashed link to confirm it, for a day or until you use it;
  then, for a week, the old address and a hashed link sent to it that puts it
  back. A change we make for you is recorded with who made it.
- **The language, country and time zone your app is set to**, as it last
  said, so the emails we send you are in your language and give times on
  your own clock. The time zone is your device's setting (for example
  "Europe/London"), not your location.
- **If you arrived by somebody's referral link** (squish.online/r/…) and
  then made an account: which referrer's code you came with, and when. That
  is so we can pay them their share of a subscription; they are told how many
  people signed up and subscribed through their link, never who. The code is
  kept in your browser for 30 days after you follow the link and deleted
  once it has been used. Following a link adds one to a count of visits and
  records nothing about you. A code you type in when setting up is kept and
  used the same way — and if it is an invite to Squish Plus instead, it is
  applied to your new account, as it would be from the You screen.

- **If you invite friends:** your invite code, and for each person who made
  an account with it, that they did, and whether and when they earned the
  reward. You see how many joined and how many got going, never who. **If a
  friend invited you:** that they did, and when you earned the reward. To
  decide that, we check that your email address is confirmed and count the
  different days your devices used Squish after you joined — the same daily
  record as above, nothing about what you logged. All of it is deleted with
  the account.

- **If you join a squad:** the squad, the first name you chose for it, and
  what your app shares with the other members — your streak, the last day
  you logged, how many days you logged this week, the badges you have earned,
  and how your Squish looks. Never your meals, calories, weight or email
  address. The cheers you send and receive (from a fixed list — there is no
  free text), and anybody you block. Leaving the squad deletes what you
  shared with it; deleting your account deletes all of it.

### If you are one of our partners

Partners — people paid a share of the subscriptions their link brings — have
a page of their own. For that we hold your name, the email address you sign in
with, your link's code and terms, a count of visits to your link each day, and
the payments we have made you. Signing in uses a link emailed to you, spent
once and stored hashed, and starts a session in your browser that lasts 30
days. Your page shows totals only: never who signed up through your link.

### What we do not hold

No analytics. No advertising identifiers. No third-party trackers. No
behavioural profiling. No location data. No contacts, no calendar, no
microphone recordings — voice logging happens in your browser and only the
resulting text reaches us. We do not log your requests; the server writes to
its log only when something fails, and those entries do not contain your diary.

### Our website

The website at squish.online sets no cookies, runs no analytics and loads
nothing from anybody else — not even its font. The app itself lives at
app.squish.online.

It shows itself in the language your browser asks for first, or the one you
pick at the bottom of the page, which becomes part of the address
(squish.online/es/). Prices — and, in English, American or British
spelling — follow the country your browser's language names (English as
spoken in Australia, say), or the country your device's clock is set to, or
the one you pick under the prices. The clock is read by the page in your
browser; your time zone is never sent. When the clock names a country that
spells differently, the page asks for itself again with that country in the
address (squish.online/?country=GB), so our server learns the country it
guessed, as it would from your pick. The website never looks up where you
actually are, and nothing remembers either choice but the address itself.
This policy is translated too, for reading, and in the US it is shown with
American spelling, and elsewhere with a country's own word where it has one
(a family doctor in Canada, say); if any of those and the British English
ever differ, the British English is what counts.

Squish used to live at squish.online, and a browser keeps what a site saves
under the address it was saved at. So if you used Squish there before it
moved, your diary is still in that browser, and the website can see it — in
your browser, not on our server. It offers a button to take it with you.
Only if you press it is the diary saved to our server, exactly as the app's
backup would have done, and handed to the app at its new address.

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

Four companies process data on our behalf. We have no other recipients, and we
do not sell data to anybody.

### Anthropic and Google — the AI

Sent to Anthropic's Claude API or Google's Gemini API, and only when you do
one of these things:

| When you | What is sent |
|---|---|
| Photograph a meal | The photo, to be read, and your diet if you told Squish one (so a vegetarian's burger is read as a veggie one). The photo is not kept afterwards — not by us and not on our server |
| Take a quick snap (the widget) | The same as photographing a meal. The difference is where it waits: so that you can put your phone away at once, the photo is handed to our server, which has it read whether or not the app is still open. Our server holds the photo only until it has been read — usually a few seconds — and what was read only until your app next opens and collects it. Anything not collected is deleted after a week |
| Describe a meal in words or by voice | What you wrote or said, and your diet if you told Squish one |
| Import a recipe from a link | The text of that page |
| Ask the nutritionist something | Your message, and whatever it looks up from your diary to answer you — meals, totals, trends, and any notes it has kept — and how you eat and what you want from Squish, if you told it when setting up. Carrying on a past chat sends that chat's earlier questions and answers with it; and when you refer back to something from an earlier chat, the parts of your past chats it looks up to answer |
| Ask the nutritionist to plan your week | Your daily targets, goal and sex (for the minimum it will plan to), the names of meals you eat often, meals you kept from a plan and foods you have saved, the meals already planned on those days (so it plans around them), how many you cook for if it is more than you, how your last plans went (the names of planned meals you made, skipped or swapped, and any you marked "Not for me"), the notes it has kept, how you eat (your diet, allergies and foods you never eat) and what you want from Squish, and anything you typed for the plan |
| Swap a planned meal for another (Plus) | The meal being swapped (its name, calories and protein), the names of the other meals on your plans, your goal and sex, the notes the nutritionist has kept, and how you eat (your diet, allergies and foods you never eat) |
| Open a planned meal for its recipe (Plus) | The meal's name and its ingredients with their amounts, how many it is cooked for, and your diet if you told Squish one. Nothing else about you: the steps written are kept and shown to anybody who plans the same meal, so they hold nothing personal |
| Open Home (the daily nudge) | The first name you gave, today's totals so far and your water, your streak, the titles of today's meals, and how you eat and what you want from Squish if you told it |

Each of these also carries which of the six countries you chose (the UK,
Ireland, the US, Canada, Australia or New Zealand) and whether you count in
kcal or kJ, and the language you chose for the AI, so the answer uses your
words and units. That is a setting, not a
location: Squish never asks your phone where it is. It starts as a guess from
your device's language and clock settings, made on the device, and you
confirm or change it when you set up.

Separately, the app's own wording (buttons, headings, help text) is translated
by the same AI once for everybody; nothing about you goes with that.

**Which of the two reads it.** Each kind of request above goes to one AI
first, chosen by us for how well and how cheaply it does that job; most go to
Claude. If that one is down, overloaded or gives an answer that makes no
sense, the same request is sent to the other instead, so that your meal is
read rather than guessed at. A request goes to a second company only when the
first has failed to answer it. Which AI does which job can change as the
models improve; this section is kept up to date if the companies change.

**Anthropic** process what they are sent to produce the answer and return it.
Their handling is governed by their own terms and privacy policy, at
[anthropic.com/legal/privacy](https://www.anthropic.com/legal/privacy).

**Google** are used through the paid Gemini API. On the paid service, Google
do not use what we send — photos included — or the answers, to improve their
products, and they keep them only for a limited time, to detect misuse of the
service and meet their legal obligations. They process it on our behalf under
their data processing terms. Their handling is governed by the
[Gemini API terms](https://ai.google.dev/gemini-api/terms) and Google's
privacy policy, at [policies.google.com/privacy](https://policies.google.com/privacy).

The nutritionist is the one to be aware of: answering "am I getting enough
protein?" means sending a slice of your diary along with the question.

### Google and Apple — signing in

Only if you choose "Continue with Google" or "Continue with Apple". Nothing is
loaded from Google or Apple, and nothing is sent to them, until you tap one of
those buttons: the sign-in happens in their own window, on their site, under
their own privacy policies
([policies.google.com/privacy](https://policies.google.com/privacy),
[apple.com/legal/privacy](https://www.apple.com/legal/privacy/)). They tell
us who you are there — an id and your email address — and we do not ask
them for anything more. They learn that you signed in to Squish. You can
always use an email address and password instead.

### Open Food Facts — barcodes

When you scan a barcode, the number alone goes to
[world.openfoodfacts.org](https://world.openfoodfacts.org) to look up the
product. Nothing about you goes with it. Scanning the same barcode twice does
not ask them twice.

### Have I Been Pwned — checking passwords

When you choose a password, we check whether it already appears in a known
data breach, because a password that does is one of the first an attacker
tries.

**Your password is not sent.** We take a SHA-1 hash of it and send the *first
five characters of that hash* to
[haveibeenpwned.com](https://haveibeenpwned.com), which returns every leaked
hash beginning with those five — hundreds of them — and we look for yours in
the list ourselves. They learn that somebody asked about one of roughly half a
million possibilities. They do not learn your password, that it was you, or
whether there was a match.

If that check cannot be made, your password is accepted anyway. We would
rather let a weak password through than stop you making an account because
somebody else's service is down.

### Our email provider — the emails we send you

Squish sends exactly five kinds of email to people who use it, and only
these:

- **A link to confirm your address**, when you make an account.
- **A password-reset link**, when you ask for one.
- **A security notice**, when your account is signed into, or its password is
  changed or reset — so that if it was not you, you find out.
- **A thank-you for inviting a friend**, when somebody who joined with your
  invite has got going and you have earned the reward. It says what you got,
  never who the friend is.
- **About changing your address**, when you ask to: a link to confirm the new
  address, sent to it; a notice to your old address once it has changed, with
  a link to put it back; or, if the new address already has a Squish account,
  a note to that address saying nothing has changed.

Each is written in the language you use Squish in, translated by the AI once
for everybody as the app's wording is; nothing about you goes with that.

Partners are also sent a sign-in link for their page, when they ask for one
or when we send them one (see above). That one is in English.

Security notices, the notice that your address changed, and the thank-you
only go to an address you have confirmed, so nobody can use Squish to send
mail to someone else. A thank-you earned before you confirm is sent when you
do, if it is still under a month old. There is no marketing, no newsletter,
and nothing else. To send these, your address and the message pass through our
email provider, [Resend](https://resend.com), who deliver them on our behalf
and do not use them for anything else. Their handling is governed by their own
privacy policy, at
[resend.com/legal/privacy-policy](https://resend.com/legal/privacy-policy).

### Our host

The server and its database run on Render, in their Frankfurt data centre in
Germany. They hold the data on our behalf and do not use it for anything else.

### Recipe links

When you paste a recipe link, our server fetches that page. The site you linked
to sees a request from our server, not from you — your address is not passed on.

### Outside the UK

<!--
  Worth confirming once, and re-checking if a provider changes: that the data
  processing terms are in place with Anthropic (part of their commercial terms
  for API customers), with Google (the Gemini API key must belong to a Google
  Cloud project with billing turned on — the free tier lets Google use what
  is sent — and the project's data processing terms accepted in the Cloud
  console), and with Resend (their DPA, on their legal pages). This section
  says those terms carry the safeguards for US transfers.
-->

Our server and the companies above are not in the UK, so here is where
your data goes when it leaves your device:

- **Your backup and account** are stored in Germany, in the EU. UK law treats
  the EU as protecting personal data to the same standard as the UK, so no
  extra safeguards are needed.
- **Anthropic, Google and Resend** are in the United States. What goes to
  them — what you ask the AI, and the emails we send you — is covered by the
  data protection terms each of them has with us, which include the
  safeguards UK law requires when personal data leaves the UK.

The barcode and password checks above send nothing that identifies you, so
where those services are makes no difference to you.

---

## How long it is kept

- **Your diary backup:** until you delete it. Deleting your account or pressing
  Reset removes it immediately.
- **Your photographs:** on your device only, until you delete the meal or press
  Reset. Deleting a meal deletes its picture.
- **Past chats with the nutritionist:** on your device, the newest 30 and
  none older than 90 days. Delete any of them from the list of past chats;
  Reset deletes them all from the device. If you back them up, the backup
  holds them until you turn that off or delete your account.
- **A quick snap on our server:** the photo until it has been read (seconds,
  as a rule), and the reading until your app collects it, the next time it is
  open. Neither is kept for more than a week.
- **Your account:** until you delete it.
- **Signed-in devices:** until you sign them out. **You → Account → Sign out
  other devices** ends every other session at once, which is what to use if
  you lose a phone. Changing your password does the same thing, and resetting
  it signs out everything including the device doing the resetting.
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
- Passwords are checked against known breaches when you set one, without the
  password leaving — see above.
- You can end every other signed-in session at once, without waiting for
  anything to expire.
- Once your address is confirmed, you are emailed whenever your account is
  signed into or its password changes.

No system is perfect, and Squish is a small one. If you find a security problem,
please tell us at the address below rather than anywhere else first.

---

## Age

Squish is not intended for under-18s. It shows calorie figures and diet
feedback, and that is not something to put in front of children without more
care than a food diary can take. Please do not use it if you are under 18.

Setting Squish up asks your age, and an age under 18 stops there: Squish
explains why and points to people who can help. The age typed is not saved or
sent anywhere. A diary already set up with an age under 18 is paused the same
way until the age is corrected.

---

## Changes

If this policy changes in a way that affects what we do with your data, the app
will say so rather than quietly swapping the page. The date at the top is when
it last changed.

---

## Contact

Squish is run by **Industry Logic Limited**, a company registered in England
and Wales, which is the data controller for everything described here.

<!--
  The ICO data protection fee renews every year, from September 2026.
-->

**Company number:** 08236014

**ICO registration:** ZC255410

**Registered office:** 38a Bowes Street, Blyth, Northumberland, NE24 1BE,
United Kingdom

**Email:** [privacy@squish.online](mailto:privacy@squish.online)

Write to us about anything in this policy, to make a request about your data,
or to report a security problem. If you are not satisfied with how we handle
it, you can complain to the Information Commissioner's Office at
[ico.org.uk](https://ico.org.uk).
