# Cakezee Backend

Backend API for Cakezee, a bakery ordering platform featuring secure authentication, role-based access for Admin, Kitchen, and Delivery staff, order management, and MongoDB integration.

## GA4 admin reports

The admin dashboard reads GA4 reports through the authenticated endpoint:

```text
GET /api/v1/admin/analytics/overview?startDate=7daysAgo&endDate=today
```

Only authenticated users with the `admin` role can access it. Report responses are cached in backend memory for 10 minutes, requests are rate limited, and accepted date ranges are restricted to 90 days or less. Google API calls have a 12-second timeout and at most one retry for transient/quota errors. No analytics credentials are returned to the frontend.

Set `GA4_PROPERTY_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` as protected backend environment variables. The frontend hosting service needs `VITE_GA4_MEASUREMENT_ID` and the existing `VITE_API_URL` pointing to this backend's `/api/v1` API base URL. Use the example env files as variable-name references only.

The Google Cloud Analytics Data API must be enabled and the service account must have Viewer access to the GA4 property. Do not commit the service-account JSON or place it in a frontend environment variable. No hosting-provider deployment configuration is present in this repository, so configure variables in the environment settings for the service that deploys each app.

## Customer email OTP and checkout

Website checkout and the combined order form verify an email on the Delivery/details page. The backend generates a cryptographically secure six-digit code, stores only its HMAC hash in MongoDB, and sends it through Sendliberty. A successful verification issues a short-lived signed token bound to the normalized email and checkout ID. Order endpoints validate that token again before creating an order; a client-side verification flag is never trusted. OTP challenges expire after five minutes, permit at most five incorrect attempts, and enforce resend cooldowns and IP-based rate limits.

### Email OTP environment

Set these variables only on the backend, locally in the ignored `Backend/.env` and as protected environment variables on Render:

| Variable | Purpose |
| --- | --- |
| `SENDLIBERTY_API_KEY` | Sendliberty API key, sent in the documented `x-api-key` header. |
| `EMAIL_FROM` | Verified sender address/name configured with Sendliberty. |
| `OTP_HASH_SECRET` | Random secret of at least 32 characters used to HMAC OTP values. |
| `JWT_SECRET` | Existing backend signing key, also used to sign email-verification tokens. |

Sendliberty delivery uses its documented `POST https://sendliberty.com/api/send` endpoint. Provider failures return a safe error and are not represented as successful sends. The API key, hash secret, and email-verification token are never Vite variables.

### Email OTP endpoints

- `POST /api/v1/auth/email-otp/request` accepts `{ "email", "checkoutId" }`; the response does not reveal whether the address belongs to an existing customer.
- `POST /api/v1/auth/email-otp/verify` accepts `{ "email", "checkoutId", "code" }` and returns a short-lived `verificationToken` after successful verification.
- `POST /api/v1/orders/email` and `POST /api/v1/orders/email/shared-form` require `customerEmail` and a matching `emailVerificationToken` in the order body.
- `POST /api/v1/orders/email/orders` requires the same email, checkout ID, and signed token to load orders saved against that verified email.

New orders save `customerEmail`; the field is optional so existing orders remain readable. Previously created orders without an email are not automatically linked to a newly verified address and remain available to staff in the existing order system. Staff sign-in and role-based access continue to use backend-issued staff JWTs. Firebase Admin support is retained server-side for legacy customer tokens and admin customer records; frontend checkout no longer uses Firebase Phone Authentication.

### Render and Netlify deployment

1. In Render's backend service environment settings, add `SENDLIBERTY_API_KEY`, `EMAIL_FROM`, and a fresh random `OTP_HASH_SECRET` (at least 32 characters). Keep the existing `JWT_SECRET`, MongoDB, and other backend settings unchanged.
2. Deploy/restart the backend. Ensure the MongoDB database user can create indexes; the OTP challenge collection uses an expiry index.
3. Keep `VITE_API_URL` configured in the Netlify frontend build environment to the Render `/api/v1` URL. No email provider secret or `VITE_FIREBASE_*` values are required in Netlify.
4. Trigger a fresh Netlify build after removing obsolete frontend Firebase phone-auth configuration. Verify delivery through a real Sendliberty request before announcing email OTP as live.

For local development, copy the example env files, configure the three backend email variables, then run `npm run dev` in `Backend` and `Frontend`.

## Tests

Run `npm test` from `Backend` to check order-slot rules, authentication and authorization, analytics reporting, and email OTP validation, cooldown, expiry, attempt limits, provider failures, and signed-token behavior.
