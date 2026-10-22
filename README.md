# Cakezee Backend

Backend API for Cakezee, a bakery ordering platform featuring secure authentication, role-based access for Admin, Kitchen, and Delivery staff, order management, and MongoDB integration.

## GA4 admin reports

The admin dashboard reads GA4 reports through the authenticated endpoint:

```text
GET /api/v1/admin/analytics/overview?startDate=7daysAgo&endDate=today
```

Only authenticated users with the `admin` role can access it. Report responses are cached in backend memory for 10 minutes, requests are rate limited, and accepted date ranges are restricted to 90 days or less. Google API calls have a 12-second timeout and at most one retry for transient/quota errors. No analytics credentials are returned to the frontend.

### Environment configuration

Set these variables on the **backend hosting service** (and in the ignored `Backend/.env` file for local development):

| Variable | Value |
| --- | --- |
| `GA4_PROPERTY_ID` | Numeric GA4 Property ID (not the `G-...` Measurement ID). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Entire service-account JSON key as a secret value. |

The frontend hosting service needs `VITE_GA4_MEASUREMENT_ID` set to the web stream Measurement ID (`G-...`). It also needs the existing `VITE_API_URL` value pointing to this backend's `/api/v1` API base URL. Use `Frontend/.env.example` and `Backend/.env.example` as variable-name references only.

### Secret handling and GA4 setup

1. In GA4 Admin, copy the **numeric Property ID**. In Google Cloud, confirm the Analytics Data API is enabled and that the existing `cakezee-analytics` service account has Viewer access to this GA4 property.
2. Create or retrieve a service-account JSON key only if needed. Store it in the backend host's encrypted environment-variable/secret settings as `GOOGLE_SERVICE_ACCOUNT_JSON`. For local development, put the JSON value in the ignored `Backend/.env`. Never commit the actual JSON key, put it in `Frontend/.env`, or expose it in a `VITE_` variable.
3. Set `GA4_PROPERTY_ID` as a backend secret/environment variable and `VITE_GA4_MEASUREMENT_ID` as a frontend build-time environment variable in the frontend hosting service.
4. Restart/redeploy the backend after setting secrets and rebuild/redeploy the frontend after setting Vite variables. Verify `/health`, then open `/admin/analytics` as an admin user.
5. If the API reports missing access, verify the property ID and service-account Viewer permission. If Google reports quota exhaustion, wait for the quota window to recover. The app does not enable billing, change roles, or create paid resources.

No hosting-provider deployment configuration is present in this repository, so the production hosting platform cannot be identified from the checked-in files. Configure each variable in the environment settings of the service that builds/hosts that repository.

### Local development

1. Add backend values to `Backend/.env` (do not commit it) and frontend values to `Frontend/.env`.
2. Start the backend with `npm run dev` from `Backend` and the frontend with `npm run dev` from `Frontend`.
3. Sign in with an admin account and select **Analytics** in the staff navigation. Missing backend credentials or property configuration produce a safe configuration message; GA4 may take 24–48 hours to populate new data.

The Google Analytics Data API and GA4 property must be available to the project. This integration does not create Google Cloud hosting or billing resources. Standard GA4 reporting quotas still apply.

### Tests

Run `npm test` from `Backend` to check analytics date validation, report mapping/caching, safe upstream/quota errors, controller responses, and admin role authorization.
