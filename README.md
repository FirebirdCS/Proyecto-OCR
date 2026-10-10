# OCR Platform — project base

A two-package TypeScript workspace managed with **pnpm**:

| Package  | Stack                                                     | Dev port |
| -------- | --------------------------------------------------------- | -------- |
| `client` | React 19, Vite, React Router, Firebase JS SDK              | 5173     |
| `server` | Node, Express 5, firebase-admin, Cloud Vision, Nodemailer  | 4000     |

## Layout

```
client/
  src/lib/firebase.ts            Firebase web SDK (Auth, Firestore, Analytics)
  src/context/AuthContext.tsx    Session + role state
  src/components/ProtectedRoute.tsx  <ProtectedRoute roles={[...]}/> and <RoleGate/>
  src/components/admin/          Users, Products, Campaigns panels + CampaignEditor
  src/services/api.ts            fetch wrapper that attaches the ID token
  src/types/                     roles.ts and campaigns.ts — mirrors of the server's
  src/pages/                     Login, Dashboard, Admin, Forbidden
server/
  src/config/env.ts              Zod-validated environment
  src/config/firebase.ts         firebase-admin bootstrap
  src/middleware/auth.ts         Token verification + requireRole/requireAdmin
  src/types/roles.ts             Role union, default role, claim name
  src/types/campaigns.ts         Campaign/product/milestone shapes and their rules
  src/services/users.service.ts  Profile provisioning, invites, role changes
  src/services/products.service.ts   The scoring table
  src/services/campaigns.service.ts  Campaign rules and lifecycle
  src/services/mail.service.ts   SMTP transport (Nodemailer)
  src/services/mail.templates.ts Invite email
  src/services/ocr.service.ts    Google Cloud Vision text detection
  src/scripts/                   create-user.ts, grant-role.ts
  src/routes/admin/              users, products and campaigns endpoints
firestore.rules                  Role-aware security rules
SETUP.md                         Firebase console checklist
```

## Setup

`client/.env` already carries the Firebase web config for
**proyecto-ocr-d3ecd**. **[SETUP.md](SETUP.md)** covers what is left: creating
the Firestore database, enabling Email/Password auth, downloading the service
account key, and making the first admin.

```bash
pnpm install
pnpm user:create you@example.com admin   # once the service account is in place
pnpm dev                                 # client + server together
```

`pnpm dev` starts Vite on 5173 and the API on 4000; Vite proxies `/api` to the
API, so the browser stays on one origin.

### Why pnpm

`pnpm-workspace.yaml` defines the two packages, and `packageManager` in the root
`package.json` pins the version. Scripts use `pnpm --filter <name>`, so npm and
yarn are not interchangeable here — `package-lock.json` and `yarn.lock` are
git-ignored on purpose.

pnpm refuses to run dependency install scripts unless they are approved. The
three that genuinely need theirs are listed under `allowBuilds` in
`pnpm-workspace.yaml`; if you add a dependency that wants one, `pnpm
approve-builds` edits that list for you.

| Command                          | Effect                                |
| -------------------------------- | ------------------------------------- |
| `pnpm dev`                       | Client and server in watch mode       |
| `pnpm build`                     | Type-check + compile both packages    |
| `pnpm start`                     | Run the compiled API                  |
| `pnpm typecheck`                 | Type-check without emitting           |
| `pnpm user:create <email> [role]` | Create an account and print its invite link |
| `pnpm role:grant <email> <role>` | Set someone's role from the terminal  |
| `pnpm --filter @ocr/client <s>`  | Run a script in one package           |
| `pnpm add -D vitest -w`          | Add a dependency to the root          |
| `pnpm --filter @ocr/server add x`| Add a dependency to one package       |

## Roles

Two roles, `admin` and `user`, defined once per side in `types/roles.ts`.

**Where a role lives.** The role is a Firebase Auth **custom claim** on the ID
token (`role: "admin" | "user"`), which makes it available to three places at
once: the API middleware, the Firestore security rules
(`request.auth.token.role`), and the React client. It is mirrored into
`users/{uid}` in Firestore so the admin screen can list and search accounts —
but the claim is the source of truth. Only the Admin SDK writes either one; the
rules deny all client writes to both collections, so nobody can promote
themselves.

**How an account gets one.** The client calls `GET /api/me` right after
sign-in. `ensureUserProfile` creates the Firestore profile on first sight and
assigns `user`, unless the email is listed in `BOOTSTRAP_ADMIN_EMAILS`, which
makes the first administrator without a console visit. After that, admins
change roles from `/admin`, or you run:

```bash
pnpm role:grant someone@example.com admin
```

**Enforcing it.**

```ts
// server — deny at the route
apiRouter.use('/admin', adminRouter);          // adminRouter uses requireAuth + requireAdmin
router.get('/thing', requireAuth, requireRole('admin', 'user'), handler);
router.get('/users/:uid', requireAuth, requireSelfOrAdmin('uid'), handler);
```

```tsx
// client — hide the route, and the entry point that leads to it
<Route element={<ProtectedRoute roles={['admin']} />}>
  <Route path="/admin" element={<AdminPage />} />
</Route>

<RoleGate roles={['admin']}><Link to="/admin">Manage users</Link></RoleGate>
```

The client guard is a convenience, not a control: every protected route has a
server-side check behind it, and the Firestore rules hold even if someone talks
to the database directly.

**Propagation delay.** ID tokens are cached for up to an hour, so a demoted
admin keeps their old token until it refreshes. The client calls
`refreshRole()` (`getIdToken(true)`) after `/api/me` reports a role that differs
from the cached claim; anything security-critical should re-check server-side,
which the API always does.

### Adding a third role later

Add it to both `types/roles.ts` files and to the `ROLES` tuple — the Zod
`z.enum(ROLES)` on `PATCH /api/admin/users/:uid/role`, the admin dropdown, and
every `requireRole(...)` call site pick it up from there. Only the rules file
names roles as strings, so grep `firestore.rules` too.

## The admin panel

`/admin` is admin-only and has three tabs.

**Users.** There is no public sign-up. An admin enters an email, and the API
creates the account with a random password nobody ever sees, stamps the `user`
role claim, and emails a *set your password* link built with
`generatePasswordResetLink`. So no password ever travels by email. If SMTP is
not configured yet, the account is still created and the link comes back in the
response for the admin to pass on by hand. The tab also re-sends invites,
changes roles, and disables accounts without deleting their history.

**Products.** The scoring table: a name, an optional SKU, and what one unit is
worth. Points are edited inline and committed on blur. Deleting a product that
a draft or active campaign still scores against is refused — deactivate it
instead, so past campaigns keep meaning what they meant.

**Campaigns.** Where the rules get written:

- *Which products count* — tick them from the catalogue.
- *What each is worth here* — every campaign carries its own points-per-unit,
  seeded from the product default. Double points on one product for one
  campaign without touching the product itself.
- *Required products* — mark a product required and set a minimum quantity, for
  goals that can't be met purely on points.
- *Milestones* — a ladder of named point targets with optional rewards. Every
  assigned user is measured against the same ladder **individually**.
- *Who takes part* — the accounts the milestones apply to.

A campaign is born as a `draft`, becomes `active` when the admin starts it, and
ends `archived` (read-only). It cannot go active without at least one product
and one milestone.

### The rules that are actually enforced

These live in `server/src/types/campaigns.ts` and run on every write, so a
hand-rolled API call can't get around what the form prevents:

| Rule                                          | Why                                              |
| --------------------------------------------- | ------------------------------------------------ |
| End date after start date                      | A campaign nobody can enter                       |
| No duplicate product in one campaign           | Two point values for the same thing               |
| Unique milestone ids                           | Progress could not be attributed                  |
| Milestone targets strictly increase            | Clearing one rung would silently clear another    |
| Required product needs `minQuantity >= 1`      | "Required, zero needed" means nothing             |
| Points `>= 0`, milestone targets `>= 1`        | Negative or free milestones                       |
| Referenced products exist and are active       | Scoring against something nobody can sell         |
| Product delete blocked while a campaign uses it| Dangling references in live rules                 |
| Archived campaigns are read-only               | History stops changing under people               |

## Firebase configuration

1. Create a project at <https://console.firebase.google.com>.
2. **Auth** — enable the Email/Password provider.
3. **Firestore** — create a database, then deploy the rules and the index the
   document query needs:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
4. **Web app** — copy the config values into `client/.env`.
5. **Service account** — Project settings > Service accounts > Generate new
   private key. Save it as `server/serviceAccount.json` (git-ignored) or inline
   the three `FIREBASE_*` values in `server/.env`.
6. Put your own email in `BOOTSTRAP_ADMIN_EMAILS` before your first sign-in.

## OCR

Firebase has no OCR service of its own; text extraction runs through the
**Google Cloud Vision API** on the same GCP project that backs Firebase. Enable
the Cloud Vision API in the Google Cloud console and grant the service account
the *Cloud Vision AI User* role. The same credentials serve firebase-admin and
Vision.

`POST /api/ocr` takes `multipart/form-data` with a `file` and a `campaignId`.
It is open only to `user` accounts that take part in that campaign, and only
while the campaign is running. It runs text detection (PDFs through Vision's
file endpoint), rebuilds the receipt row by row, and finds that campaign's
products. Each one is worth *units × points per unit*.

A receipt earns nothing without a TOTAL line and a printed date inside the
campaign's dates. A product line with no price on it is not counted. The
response carries the text, and a `scoring` breakdown with any `issues`. The
same receipt gets a 409 if it's scanned twice, even from a new photo or a
different account. `samples/` has a valid ticket, an out-of-date one, and a
hand-written note to try each case.

Every uploaded file is kept in Cloud Storage (`FIREBASE_STORAGE_BUCKET`) as
evidence. Admins review scans under **Comprobantes**, where they can see the
file, the matched lines and any flags, and void a scan to take its points back.
`SCAN_DAILY_LIMIT` caps scans per user per 24 hours. `RECEIPT_MAX_UNITS` caps
the units one receipt can count.

Unusual receipts are flagged for review: capped units, a line with 10 or more
units, a user with 5 or more scans in a day, or a file that could not be kept.
Run `firebase deploy --only firestore:indexes,storage` after pulling this.

`GET /api/admin/dashboard` feeds the admin landing page: products registered,
units sold per day (30 days), per week (12 weeks) and per month (12 months), and
the best sellers. Days are cut in `STATS_TIME_ZONE`; empty means the server's
own zone.
`GET /api/ocr/documents` returns the caller's history; admins may add
`?ownerUid=<uid>` to read someone else's.

## SMTP

`server/src/services/mail.service.ts` builds a Nodemailer transport from the
`SMTP_*` variables. Port 587 with `SMTP_SECURE=false` is STARTTLS; port 465
needs `SMTP_SECURE=true`. `POST /api/mail/send` is authenticated and takes
`{ to, subject, text | html }`.

## Deploying the API to Cloud Run

The `Dockerfile` builds the server alone. **No key file goes into the image** —
the service runs as a service account, and firebase-admin, Firestore, Storage
and Vision all authenticate as that identity.

`scripts/deploy-api.ps1` runs every step below, so nothing long has to be pasted
into a shell. After `gcloud auth login`:

```powershell
.\scripts\deploy-api.ps1
# ...and again once the site is live, to let the API accept that origin:
.\scripts\deploy-api.ps1 -SkipSetup `
  -ClientOrigins http://localhost:5173,https://<user>.github.io `
  -ClientAppUrl https://<user>.github.io/Proyecto-OCR
```

`-TimeZone`, `-ScanDailyLimit`, `-ReceiptMaxUnits` and the rest are parameters
with defaults; `Get-Help .\scripts\deploy-api.ps1 -Detailed` lists them. What
the script does, by hand:

```bash
gcloud config set project proyecto-ocr-d3ecd

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

# The Firebase Admin SDK account already has Firestore, Auth and Storage access.
# It is the "client_email" in serviceAccount.json (IAM > Service accounts).
SA=firebase-adminsdk-XXXXX@proyecto-ocr-d3ecd.iam.gserviceaccount.com

# Signed URLs for receipt evidence are signed through IAM, because the image
# holds no private key. This lets the account sign as itself.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator

gcloud run deploy ocr-api \
  --source . \
  --region us-central1 \
  --service-account "$SA" \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 120 \
  --max-instances 3 \
  --set-env-vars "NODE_ENV=production,APP_NAME=Plataforma OCR,\
CLIENT_ORIGIN=http://localhost:5173,\
FIREBASE_STORAGE_BUCKET=proyecto-ocr-d3ecd.firebasestorage.app,\
STATS_TIME_ZONE=America/Mexico_City,SCAN_DAILY_LIMIT=20,RECEIPT_MAX_UNITS=50"
```

`--allow-unauthenticated` lets the browser reach the service; the API still
rejects every request without a Firebase ID token.

Leave `GOOGLE_APPLICATION_CREDENTIALS` and `VISION_KEY_FILE` unset in Cloud Run.
Setting them makes the server look for a file that is not there.

### The Resend key

Invite emails need `RESEND_API_KEY`, which belongs in Secret Manager, never in
`--set-env-vars`. `scripts/set-resend-key.ps1` asks for the key without echoing
it, stores it, grants the service account access and points the service at it:

```powershell
.\scripts\set-resend-key.ps1
```

Rotating the key is the same command again — it adds a version, and the service
picks it up when it next starts. Without the key the API still creates accounts
and returns the invite link; only the email is skipped.

Deploy prints a service URL like `https://ocr-api-xxxxxxxx-uc.a.run.app`. Check
it with `curl <url>/api/health`, then feed it to the client build as
`VITE_API_BASE_URL`. Once the site is live, point the API back at it:

```bash
gcloud run services update ocr-api --region us-central1 \
  --update-env-vars "CLIENT_ORIGIN=http://localhost:5173\,https://<user>.github.io,\
CLIENT_APP_URL=https://<user>.github.io/Proyecto-OCR"
```

The comma inside `CLIENT_ORIGIN` is escaped as `\,` because gcloud splits on
commas.

## Deploying the client to GitHub Pages

`.github/workflows/pages.yml` builds `client/` on every push to `master` and
publishes it. **Pages serves static files only, so the API is not deployed with
it** — host the server elsewhere and point the build at it.

1. **Settings > Pages > Source:** GitHub Actions.
2. **Settings > Secrets and variables > Actions > Variables:** add every
   `VITE_FIREBASE_*` value from `client/.env` (they ship in the bundle anyway,
   so they are variables, not secrets), plus `VITE_API_BASE_URL` with the API's
   public address.
3. **Firebase console > Authentication > Settings > Authorized domains:** add
   `<user>.github.io`, or sign-in is refused.
4. **On the server:** put the Pages origin in `CLIENT_ORIGIN` (comma-separated,
   alongside `http://localhost:5173`) and the full address, sub-path included,
   in `CLIENT_APP_URL`.

The build sets Vite's `base` from `VITE_BASE`, and the router picks that up
through `import.meta.env.BASE_URL`. Deep links work because `404.html` is a copy
of `index.html`.

### With a custom domain

`client/public/CNAME` holds the domain, which also keeps the Pages setting from
being cleared by a deploy. A custom domain serves the site from the domain
**root**, so `VITE_BASE` must be `/` — the default. Leaving a `/<repo>/` prefix
in place 404s every asset and renders a blank page with nothing in the console
worth reading. Going back to `<user>.github.io` means deleting the CNAME and
setting a `VITE_BASE` repository variable to `/<repo>/`. The new domain also has
to be added to Firebase's authorized domains and to the server's
`CLIENT_ORIGIN`/`CLIENT_APP_URL`.

## Test plan in Jira

`scripts/test-plan.json` holds the QA plan derived from the project documents:
7 epics, 17 user stories with acceptance criteria and traceability to the
HU/RF/RN/CP codes, each assigned to Sprint 1, 2 or 3, and 34 QA sub-tasks wired
to the fixtures in `samples/casos`. `scripts/jira-import.ps1` creates it in a
Jira Cloud Scrum space, moves each story into its existing sprint (dates are
never changed) and sets story points, so nobody types the board by hand:

```powershell
.\scripts\jira-import.ps1 -DryRun                       # prints the tree, creates nothing
.\scripts\jira-import.ps1 -Site https://<site>.atlassian.net `
  -Email <you>@<company>.com -Project <KEY>             # needs $env:JIRA_API_TOKEN
.\scripts\jira-import.ps1 -Csv .\plan-de-pruebas.csv    # for Jira's own CSV importer
```

Re-running it skips whatever already carries the plan's label, so cases added to
the JSON can be pushed without duplicating the board.

## Not included yet

Tests, linting config, CI, file storage, and rate limiting — all deliberately
left out of the base.
