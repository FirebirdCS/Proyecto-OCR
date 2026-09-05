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

`POST /api/ocr` takes `multipart/form-data` with a single `file` field, runs
document text detection, stores the result in Firestore, and returns the text.
`GET /api/ocr/documents` returns the caller's history; admins may add
`?ownerUid=<uid>` to read someone else's.

## SMTP

`server/src/services/mail.service.ts` builds a Nodemailer transport from the
`SMTP_*` variables. Port 587 with `SMTP_SECURE=false` is STARTTLS; port 465
needs `SMTP_SECURE=true`. `POST /api/mail/send` is authenticated and takes
`{ to, subject, text | html }`.

## Not included yet

Tests, linting config, CI, file storage, and rate limiting — all deliberately
left out of the base.
