# Squish privacy policy

**Last updated: 24 September 2026**

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
| Your meals | Titles, foods, portions, nutrition figures, and your notes — including meals you have planned for later, and your shopping list |
| Your photos | **The meal photographs themselves, which stay here.** Only a thumbnail of each — a few kilobytes — is part of the backup below |
| Your days | Water, weight entries, and the day's totals |
| Your settings | Saved foods, achievements earned, colourway, light or dark, reminder times |
| Nutritionist notes | Anything the nutritionist wrote down because you told it — an allergy, a food you avoid, what you are training for |

### On our server, if you use the backup or an account

Backup is on by default where this copy of Squish has a database.

- **Everything in the table above except the photographs**, which stay on your
  device. What is backed up is a thumbnail of each — roughly five kilobytes,
  the small square you see in the diary list. It is stored as one document per
  person, updated as you log.

  This means a restore onto a new phone brings your diary and those
  thumbnails, but not the full pictures: those were never sent. If that
  matters to you, export before you change phones.
- **A device identifier** — a random token your browser is given on first use,
  stored in a form we cannot reverse, plus when it was created and last seen,
  and which days it was used — a date, not what was done. It is how a limit
  can be counted per phone rather than per network, and how we know how many
  people use Squish each day.
- **How many photos, chats and recipes you have used today.** Counts only.
- **If you make an account:** your email address, and your password stored as
  a scrypt hash. We never store the password itself and cannot read it.
- **If you ask to reset a password:** a hashed, single-use token that expires
  after two hours.
- **Whether you have confirmed your email address**, and, until you do, a
  hashed confirmation link that expires after a week.
- **If you arrived by somebody's referral link** (squish.online/r/…) and
  then made an account: which referrer's code you came with, and when. That
  is so we can pay them their share of a subscription; they are told how many
  people signed up and subscribed through their link, never who. The code is
  kept in your browser for 30 days after you follow the link and deleted
  once it has been used. Following a link adds one to a count of visits and
  records nothing about you.

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

Three companies process data on our behalf. We have no other recipients, and we
do not sell data to anybody.

### Anthropic — the AI

Sent to Anthropic's Claude API, and only when you do one of these things:

| When you | What is sent |
|---|---|
| Photograph a meal | The photo, to be read. It is not kept afterwards — not by us and not on our server |
| Describe a meal in words or by voice | What you wrote or said |
| Import a recipe from a link | The text of that page |
| Ask the nutritionist something | Your message, and whatever it looks up from your diary to answer you — meals, totals, trends, and any notes it has kept |
| Ask the nutritionist to plan your week | Your daily targets, goal and sex (for the minimum it will plan to), the names of meals you eat often and foods you have saved, the notes it has kept, and anything you typed for the plan |

Each of these also carries which of the six countries you chose (the UK,
Ireland, the US, Canada, Australia or New Zealand) and whether you count in
kcal or kJ, and the language you chose for the AI, so the answer uses your
words and units. That is a setting, not a
location: Squish never asks your phone where it is.

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

Squish sends exactly three kinds of email, and only these:

- **A link to confirm your address**, when you make an account.
- **A password-reset link**, when you ask for one.
- **A security notice**, when your account is signed into, or its password is
  changed or reset — so that if it was not you, you find out.

Security notices only go to an address you have confirmed, so nobody can use
Squish to send mail to someone else. There is no marketing, no newsletter, and
nothing else. To send these, your address and the message pass through our
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
  for API customers) and with Resend (their DPA, on their legal pages). This
  section says those terms carry the safeguards for US transfers.
-->

Our server and the companies above are not in the UK, so here is where
your data goes when it leaves your device:

- **Your backup and account** are stored in Germany, in the EU. UK law treats
  the EU as protecting personal data to the same standard as the UK, so no
  extra safeguards are needed.
- **Anthropic and Resend** are in the United States. What goes to them — what
  you ask the AI, and the emails we send you — is covered by the data
  protection terms each of them has with us, which include the safeguards UK
  law requires when personal data leaves the UK.

The barcode and password checks above send nothing that identifies you, so
where those services are makes no difference to you.

---

## How long it is kept

- **Your diary backup:** until you delete it. Deleting your account or pressing
  Reset removes it immediately.
- **Your photographs:** on your device only, until you delete the meal or press
  Reset. Deleting a meal deletes its picture.
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
