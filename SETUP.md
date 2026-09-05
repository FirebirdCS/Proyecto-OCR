# Finishing the Firebase setup

The web config for **proyecto-ocr-d3ecd** is already written to `client/.env`.
Four things still need doing, all in the Firebase console. They take about ten
minutes.

## 1. Create the Firestore database

Console > **Build > Firestore Database > Create database**. Pick a region close
to you (`nam5` or `eur3` are the usual multi-region choices) and start in
**production mode** — this project ships its own rules and nothing writes from
the browser.

Collections are created on first write, so there is nothing to lay out by hand.
The project uses four:

| Collection  | Written by                | Holds                                   |
| ----------- | ------------------------- | --------------------------------------- |
| `users`     | `/api/me`, admin invites  | Profile mirror and the role             |
| `products`  | Admin panel               | The scoring table                       |
| `campaigns` | Admin panel               | Rules: products, points, milestones      |
| `documents` | `/api/ocr`                | OCR results                             |

## 2. Enable Email/Password sign-in

Console > **Build > Authentication > Get started > Email/Password > Enable**.
Leave "Email link (passwordless)" off — invites use a password-set link.

Then under **Authentication > Settings > Authorized domains**, confirm
`localhost` is listed. The invite email's continue URL points at
`http://localhost:5173/login`, and Firebase rejects unlisted domains. Add your
production domain there when you deploy.

## 3. Download the service account key

Console > **Project settings > Service accounts > Generate new private key**.
Save the downloaded file as:

```
server/serviceAccount.json
```

`server/.env` already points at it, and `.gitignore` already excludes
`serviceAccount*.json`. This file is a real secret — unlike the web config in
`client/.env`, it grants full admin access to the project. Don't commit it and
don't paste it into a chat.

## 4. Name the first admin

In `server/.env`, set:

```
BOOTSTRAP_ADMIN_EMAILS=you@example.com
```

That address becomes an admin the first time it signs in. But no account exists
yet and there is no sign-up page, so create yours from the terminal once the
service account is in place:

```bash
pnpm user:create you@example.com admin "Your Name"
```

It prints a set-your-password link (and emails it too, once SMTP is
configured). Open the link, choose a password, and sign in.

Every account after that one gets created from the admin panel.

## 5. Deploy the rules and indexes (optional but recommended)

The repo carries `firestore.rules` and `firestore.indexes.json`. Without the
indexes, the campaign and product queries fail with a link-to-create-index
error the first time they run.

```bash
pnpm dlx firebase-tools login
pnpm dlx firebase-tools use proyecto-ocr-d3ecd
pnpm dlx firebase-tools deploy --only firestore:rules,firestore:indexes
```

`firebase login` opens a browser, so run it yourself rather than through an
agent.

## 6. SMTP, whenever you're ready

Invite emails need `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` in
`server/.env`. Until they're set, creating a user still works — the API returns
the invite link and the admin panel shows it on screen so you can pass it on by
hand.

For Gmail, use an [App Password](https://myaccount.google.com/apppasswords) with
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`. Your normal
account password will not work.

## Then

```bash
pnpm dev
```

Sign in at <http://localhost:5173/login>, and the **Admin** link appears in the
dashboard header.
