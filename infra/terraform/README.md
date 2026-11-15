# Terraform deployment

Terraform owns the existing `btv-multiplayer` CloudFormation stack and the
application role's release permission policy. The stack continues owning its
EC2 host, security group, instance identity, private release bucket, CloudFront
VPC origin and distribution. Add hosting resources in
[`../multiplayer.template.json`](../multiplayer.template.json); add independent
Terraform resources alongside `main.tf` when useful. Do not import the stack's
child resources into Terraform as well.

The account database is defined natively in [`database.tf`](database.tf), with
private network access, TLS, encrypted storage and backups. See
[account operations](../ACCOUNTS.md) for schema, password hashing and checks.

The existing Oregon VPC, subnet, CloudFront service security group, account
GitHub OIDC provider, and application deployment role/trust are referenced,
not created here. Bolts infrastructure remains outside this configuration.
The AMI is pinned to the deployed image; automatic AMI upgrades would replace
the host. Shared network changes require separate management.

## One-time administrator setup

Run from the repository root with **Terraform 1.13.5**, AWS CLI and Python 3
installed, using administrator credentials for account `780705957578`. The
`run.py` wrapper reuses the existing AWS credential chain, including the
laptop's legacy export-format file, without printing credential values.
CI uses short-lived OIDC credentials directly.

The bootstrap creates an encrypted, private, versioned state bucket,
`TinyCivGitHubTerraform`, and the `TinyCivCloudFormation` execution role.
It reuses the existing GitHub OIDC provider. Its exact immutable main-branch
subject matches the existing application role:
`repo:tinyciv@352986322/tinyciv.github.io@1447778810:ref:refs/heads/main`.

```sh
python3 infra/terraform/run.py -chdir=infra/terraform/bootstrap init -input=false -lockfile=readonly
python3 infra/terraform/run.py -chdir=infra/terraform/bootstrap plan -out=bootstrap.tfplan
# Review the plan, then create the state bucket and infrastructure roles.
python3 infra/terraform/run.py -chdir=infra/terraform/bootstrap apply bootstrap.tfplan

# Move the initial local bootstrap state into the newly created bucket.
# backend.tf is intentionally local and ignored; keep it for later bootstrap work.
cp infra/terraform/bootstrap/backend.tf.example infra/terraform/bootstrap/backend.tf
python3 infra/terraform/run.py -chdir=infra/terraform/bootstrap init -migrate-state -backend-config=backend.hcl
```

The bootstrap state uses `bootstrap/terraform.tfstate`; Actions can access only
`production/terraform.tfstate` and its lock. Bootstrap changes remain an
administrator operation. After state migration, retain the local backup until
the remote state has been confirmed. On a fresh administrator checkout, copy
`backend.tf.example` to `backend.tf` and initialize with `-backend-config=backend.hcl`
before changing bootstrap resources; do not create a second local state.

Before enabling the workflow, adopt the existing stack and release policy:

```sh
python3 infra/terraform/run.py -chdir=infra/terraform init -input=false -lockfile=readonly
python3 infra/terraform/run.py -chdir=infra/terraform plan -out=production.tfplan
# Expect two imports, the CloudFormation service role/stack policy/tags update,
# template description/comment updates, and the application release policy.
# Inspect unexpected changes, then wait for empty matches before applying.
python3 infra/terraform/wait-for-idle.py infra/terraform/production.tfplan
python3 infra/terraform/run.py -chdir=infra/terraform apply production.tfplan
```

The committed import blocks adopt `btv-multiplayer` and
`TinyCivGitHubDeploy:DeployExistingTinyCivServer`; subsequent runs ignore
already imported resources. Review the first plan against the live account,
especially the AMI and network parameters. No duplicate host or distribution
should be created. Terraform protects the stack against destruction, and its
CloudFormation stack policy denies replacement/deletion of the current host,
release bucket, distribution and private origin. Intentional replacement
requires changing that policy and planning a maintenance window.

The workflow defaults to the bootstrap's fixed role ARN. To override it, set
the GitHub repository Actions variable:

```text
AWS_TERRAFORM_ROLE_ARN=arn:aws:iam::780705957578:role/TinyCivGitHubTerraform
```

Keep the existing `AWS_DEPLOY_ROLE_ARN` and `github-pages` environment settings.
There are no new GitHub secrets. The application role cannot provision
infrastructure; the Terraform role can manage this stack, pass its execution
role, update the application role's inline permission policy, and access
production state. It cannot change OIDC trust or bootstrap state. Main-branch
code is trusted deployment code; protect branch writes accordingly.

## GitHub Actions

The existing [release workflow](../../.github/workflows/deploy.yml) now runs:

1. Terraform formatting and validation for both roots, without AWS credentials,
   alongside the existing build and test gate. Pull requests stop here.
2. On the original repository's `main`, initialize remote state and save a plan
   using the dedicated Terraform OIDC role.
3. If the stack changes, wait up to 20 minutes for players/reconnect reservations
   to leave. Apply exactly the saved plan; failure blocks application deployment.
4. Deploy the tested server with the existing restricted application role, then
   publish GitHub Pages after server health passes.

The release workflow serializes complete releases and does not cancel them.
S3 lockfiles also serialize Terraform writers. Plans stay on the ephemeral
runner; state, plans, local variable files and `.terraform/` are ignored.
Both provider lockfiles are committed with Linux and macOS checksums.

CloudFormation resource changes can restart services. The idle preflight
does not prevent a new player arriving during an update, and Terraform does
not roll back a successful infrastructure change if a later app release fails.
The existing installer still rolls back failed application releases.

The execution role permits the hosting services currently in the template.
The Terraform role also manages the RDS account database, its firewall,
nonsecret configuration and secret containers. Secret values are initialized
on the host and remain outside Terraform state.
When adding another AWS service, update `bootstrap/cloudformation-policy.tf`
with the required permissions and apply the bootstrap as an administrator
before merging its infrastructure change. Terraform-managed resources outside
the stack likewise need explicit permissions in the Terraform role. Public
backend hostname changes also require updating `.env.production` and the
workflow's CORS allowlist before building the client.

After adoption, Terraform owns `DeployExistingTinyCivServer`; do not overwrite
that policy using the older `configure-actions-aws.py` helper. The checked-in
`actions-deploy-policy.json` remains the historical initial-setup policy.
Do not use `deploy-multiplayer.py --provision` to create this stack again;
ordinary release deployment continues using `--existing-only`.

## Local static checks

```sh
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform/bootstrap init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/terraform/bootstrap validate
```

These checks download providers but do not contact AWS or start the game.
Use a separate checkout for backend-disabled checks if your working directory
is already initialized against remote state. Provider upgrades are deliberate:
update both roots with `terraform init -upgrade`, run
`terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` in each,
and commit the resulting lockfiles.

References: [Terraform CloudFormation stack resource and imports](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cloudformation_stack),
[S3 backend locking and IAM requirements](https://developer.hashicorp.com/terraform/language/backend/s3),
[CloudFormation stack policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html).
