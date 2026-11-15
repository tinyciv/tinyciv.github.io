locals {
  database_tags = { Project = "BTV", Component = "Accounts", ManagedBy = "Terraform" }
}

resource "aws_db_subnet_group" "accounts" {
  name       = "tinyciv-accounts"
  subnet_ids = ["subnet-239e3554", "subnet-45b02520"]
  tags       = local.database_tags
}

resource "aws_security_group" "database" {
  name        = "tinyciv-accounts-database"
  description = "PostgreSQL from the TinyCiv application host only"
  vpc_id      = "vpc-b000bdd5"
  tags        = local.database_tags
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_cloudformation_stack.multiplayer.outputs.SecurityGroupId
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "TinyCiv account API"
  tags                         = local.database_tags
}

resource "aws_db_parameter_group" "accounts" {
  name   = "tinyciv-accounts-postgres18"
  family = "postgres18"
  tags   = local.database_tags

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }
}

resource "aws_db_instance" "accounts" {
  identifier                      = "tinyciv-accounts"
  engine                          = "postgres"
  engine_version                  = "18.3"
  instance_class                  = "db.t4g.micro"
  db_name                         = "tinyciv"
  username                        = "tinyciv_admin"
  manage_master_user_password     = true
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_subnet_group_name            = aws_db_subnet_group.accounts.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  parameter_group_name            = aws_db_parameter_group.accounts.name
  publicly_accessible             = false
  multi_az                        = false
  backup_retention_period         = 7
  backup_window                   = "10:00-11:00"
  maintenance_window              = "sun:11:00-sun:12:00"
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "tinyciv-accounts-final"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  tags                            = local.database_tags

  lifecycle {
    prevent_destroy = true
    # RDS installs minor security updates automatically; never downgrade them.
    ignore_changes = [engine_version]
  }
}

# Only the secret container is in Terraform. The initializer generates its
# value on the host, so no database password enters Terraform state or plans.
resource "aws_secretsmanager_secret" "database_application" {
  name                    = "tinyciv/accounts/application"
  recovery_window_in_days = 30
  tags                    = local.database_tags
}

resource "aws_ssm_parameter" "database" {
  name = "/tinyciv/accounts/database"
  type = "String"
  value = jsonencode({
    host            = aws_db_instance.accounts.address
    port            = aws_db_instance.accounts.port
    database        = aws_db_instance.accounts.db_name
    masterSecretArn = aws_db_instance.accounts.master_user_secret[0].secret_arn
    appSecretArn    = aws_secretsmanager_secret.database_application.arn
  })
  tags = local.database_tags
}

resource "aws_iam_role_policy" "database_management" {
  name = "ManageAccountDatabaseCredentials"
  role = aws_cloudformation_stack.multiplayer.outputs.InstanceRoleName
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = aws_ssm_parameter.database.arn
      },
      {
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          aws_db_instance.accounts.master_user_secret[0].secret_arn,
          aws_secretsmanager_secret.database_application.arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:PutSecretValue"
        Resource = aws_secretsmanager_secret.database_application.arn
      }
    ]
  })
}

output "account_database" {
  description = "Private account database; contains no credentials."
  value = {
    identifier = aws_db_instance.accounts.identifier
    endpoint   = aws_db_instance.accounts.address
    config     = aws_ssm_parameter.database.name
  }
}
