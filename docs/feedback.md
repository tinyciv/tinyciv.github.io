# Player feedback

Main menu → Help opens the feedback form. Signed-in reports link to the verified
account in PostgreSQL; guests use the same anonymous browser ID as telemetry.
Reports include a bounded browser user-agent, build, session, world/scenario,
mode and page path. Passwords, authentication tokens, query strings, saves and
arbitrary account data are excluded. The form identifies which details accompany
the report before sending.

`POST /api/feedback` uses the existing account service/database and CORS origin
allowlist. A supplied bearer session must be valid. Messages are limited to
4,000 characters; requests are rate limited to five per IP and signed-in account
per 15 minutes. A submission UUID makes retries safe after an uncertain response.
Draft text is retained if delivery fails. Guest reports remain accepted without
requiring an account.

The existing deployment installer runs `accounts-admin.mjs configure`, which
creates `accounts.feedback` and its indexes and grants access to `tinyciv_app`.
No separate infrastructure, public read endpoint or database credential is
needed. Local feedback needs the same `ACCOUNT_DATABASE_CONFIG` and trusted CA
as sign-in; without them the form reports that sending is unavailable.

Operators can retrieve the most recent 50 reports on the application host with
the existing database environment loaded:

```sh
node server-dist/accounts-admin.mjs feedback
```

This explicitly prints feedback and account details to the operator's terminal;
the web service never logs feedback bodies or database error objects. The
`user_id` foreign key joins `accounts.users` for email/display name. If an account
is deleted the report remains with `user_id = NULL` and its anonymous browser ID.

For a frozen UI screenshot through the permitted startup check:

```sh
npm run test:startup -- --capture-feedback
```

Screenshots are written to `output/startup/help-feedback.png` and
`output/startup/help-feedback-mobile.png`. This preview sends no feedback.
