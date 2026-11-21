# Account database and cloud saves

The account service uses PostgreSQL on RDS, managed by
[`terraform/database.tf`](terraform/database.tf). The `tinyciv-accounts` instance
is private, encrypted, backed up for seven days, and protected against deletion.
Only the application host's security group can reach port 5432. Connections use
TLS with hostname verification and the AWS Oregon RDS CA bundle; the database
requires TLS. The initial size is `db.t4g.micro` with 20 GiB gp3 storage.

The account API is separate from match simulation and guest multiplayer.
Registration requires a username. Players can sign in with their username or
with the optional email address they provided. Signed-in players save games to
their account, and guests save in the browser.
Google OAuth and password reset mail still require separate configuration.
Email addresses are normalized but are not yet verified through email.

## Stored authentication data

`accounts.users` contains the username, optional email, display name and a password hash
encoded as `scrypt$131072$8$1$<16-byte random salt>$<32-byte hash>`.
Hash comparison uses constant-time comparison. The hash cost follows the
[OWASP scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Hashing runs asynchronously with one active operation per server process to
bound memory use. Passwords must be nonempty and fit within 1024 UTF-8 bytes.
No password is stored in source, Terraform, SSM deployment
commands, database columns, browser storage, or application logs.

Sessions use random 32-byte opaque tokens. Only SHA-256 token hashes are stored
in `accounts.sessions`; sessions expire after seven days and logout revokes
them. The browser keeps its token in session storage and sends an Authorization
header. This supports the GitHub Pages frontend without third-party cookies.
Authentication attempts are limited by viewer IP and the supplied username or email using
atomic SQL counters, so a service restart does not clear the limits.

Account data is a JSON object of up to 12 KB per user in `accounts.user_data`.
Every read/write derives the user ID from the authenticated session, and all
input goes through SQL parameters. Password hashes and tokens never appear in
account API responses, apart from the new opaque token at sign-in/registration.

`accounts.game_saves` stores compressed game saves and compact catalog entries.
Save IDs are scoped to a verified account, and private save responses disable
caching. Downloads contain a single game. Catalog requests read summary fields
without loading the save payloads.

## Deployment and credentials

Complete the [Terraform bootstrap](terraform/README.md), then deploy through
GitHub Actions. Infrastructure is applied before installing the application.
The workflow uses the fixed `TinyCivGitHubTerraform` role ARN by default;
`AWS_TERRAFORM_ROLE_ARN` may override it. No AWS access-key secret is needed.

RDS generates the administrator database password into Secrets Manager; its
value never enters Terraform state. Terraform creates a separate empty
application secret container. The root-only release installer then runs the
bundled `accounts-admin.mjs configure` command. Under a SQL advisory lock, it
creates the account tables and a `tinyciv_app` database role with table access
and no database, role, schema-creation, or superuser privileges. The initializer
generates the application database password into Secrets Manager if the secret
has no value; it reuses that value on subsequent releases. The AWS CLI receives the
new service credential through a temporary file in a private directory, with
file mode `0600`; the file is removed on success or failure.

The installer writes only the restricted database connection settings to
`/etc/btv-database.json` as `root:btv`, mode `0640`. The existing unprivileged
service and instance-metadata network block remain in place. Root management
can read the RDS administrator secret; the application receives only its
restricted database credentials. The nonsecret SSM parameter
`/tinyciv/accounts/database` contains the endpoint and secret ARNs.

Schema/credential initialization must succeed before the release switches.
Application health includes an account-table query when accounts are
configured. Failed service health restores the previous application release;
successful schema/infrastructure changes remain applied.

Administrator commands on the host, via SSM:

```sh
# SQL/TLS/role checks; prints only nonsecret summary fields.
ACCOUNT_DATABASE_CONFIG=/etc/btv-database.json \
  runuser -u btv -- /usr/bin/node-22 /opt/btv/current/server-dist/accounts-admin.mjs inspect
```

To seed a requested account, the `import-user` command accepts a JSON record
with `username`, `passwordHash` and an optional `email` on stdin. Compute a salted scrypt hash using the
same password module in a trusted local process first. Transfer only that
record through SSM; never put the raw password into a shell argument, request
file, workflow, or deployment log. An existing account is never overwritten.

## Verification

```sh
npx vitest run tests/accounts.test.ts
# Requires Docker and OpenSSL; starts an API fixture, never the game.
python3 infra/test-accounts.py
```

The disposable PostgreSQL check uses a temporary trusted TLS certificate and
separate administrator/application roles. It verifies registration, salted
hashes, token hashing, correct/incorrect credentials, duplicate accounts,
profile persistence across SQL connections, cross-user isolation, expired
sessions, logout revocation, CORS, request-size limits, persistent rate
limiting, TLS, and denied schema creation. The workflow runs this check before
the existing build/test gate.

After deployment, repeat login, authenticated profile read/write, logout and
revoked-token checks against the public HTTPS API. Then use `inspect` on the
host to confirm actual RDS TLS and restricted role privileges. Local checks
alone do not establish that the cloud database or a particular user exists.
