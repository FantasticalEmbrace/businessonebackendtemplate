# Google Business Profile (hours & holidays) setup

## Important: “Enabled” ≠ “Approved”

Google Business Profile APIs are **restricted**. You can enable them in Cloud Console, but **API calls fail with 429 and quota 0** until Google approves your **Cloud project** for Basic API Access.

From [Google’s quota docs](https://developers.google.com/my-business/content/limits):

> If your quota limit is **0**, you have **not yet been granted access**. Do **not** request a quota increase. Submit the **Application for Basic API Access** instead.

**Check approval status:** Cloud Console → **APIs & Services** → **Quotas** → filter **My Business Account Management API**

| Quota shown | Meaning |
|-------------|---------|
| **0** requests/minute | Pending (or not applied) |
| **300** requests/minute | Approved — listing/sync should work |

HM Herbs OAuth project number (from `GBP_CLIENT_ID`): **266596824943**

---

## Step 1: Request Basic API Access (required first)

Prerequisites ([official guide](https://developers.google.com/my-business/content/prereqs)):

- A **verified** Business Profile active **60+ days**
- A **website** on that profile matching the business
- Apply with an email that is an **owner/manager** on the profile (e.g. `hmherbs1@gmail.com`)

1. Open the [GBP API access request form](https://support.google.com/business/contact/api_default)
2. Choose **Application for Basic API Access**
3. Enter project number **266596824943** and your business details
4. Wait for email (often a few business days); re-check quotas until you see **300 QPM**

---

## Step 2: Enable APIs (after approval)

In [API Library](https://console.cloud.google.com/apis/library) for the same project:

1. **My Business Account Management API**
2. **My Business Business Information API**

---

## Step 3: OAuth (same project)

| Setting | Local dev |
|--------|-----------|
| Redirect URI | `http://localhost:3001/api/admin/settings/google-business/callback` |
| Scope | `https://www.googleapis.com/auth/business.manage` |
| Test users | `hmherbs1@gmail.com` while app is in **Testing** |

```env
GBP_CLIENT_ID=...
GBP_CLIENT_SECRET=...
GBP_REDIRECT_URI=http://localhost:3001/api/admin/settings/google-business/callback
```

Restart the Node backend after `.env` changes.

---

## Step 4: Admin workflow (after approval)

1. **Settings → Google Business Profile** → Connect
2. Pick location → **Save Location**
3. **Store info** hours + **Holiday schedule** → save
4. **Send hours to Google now** when available

### Manual location ID (optional)

```text
locations/1234567890123456789
```

---

## Verify

```bash
cd backend
node scripts/verify-google-integrations.js
```

`List locations` should succeed after approval.

---

## Calendar vs Business

| Integration | Purpose |
|-------------|---------|
| Google Calendar | EDSA appointments (public Calendar API) |
| Google Business Profile | Hours/holidays on Maps (restricted; needs approval) |
