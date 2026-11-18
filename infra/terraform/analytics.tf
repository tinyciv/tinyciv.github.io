# Keep the collection secret and dashboard allowlist out of Terraform state.
# The operator supplies a JSON value; the host installer reads it as root.
resource "aws_secretsmanager_secret" "analytics" {
  name                    = "tinyciv/accounts/analytics"
  recovery_window_in_days = 30
  tags                    = local.database_tags
}
