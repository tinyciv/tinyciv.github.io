locals {
  account      = "780705957578"
  region       = "us-west-2"
  state_bucket = "tinyciv-terraform-${local.account}-${local.region}"
  stack_arn    = "arn:aws:cloudformation:${local.region}:${local.account}:stack/btv-multiplayer/*"
  tags = {
    Project   = "BTV"
    Component = "Terraform"
    ManagedBy = "Terraform"
  }
}

resource "aws_s3_bucket" "state" {
  bucket        = local.state_bucket
  force_destroy = false
  tags          = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# Reuse the account's existing GitHub OIDC provider, installed for app releases.
data "aws_iam_openid_connect_provider" "github" {
  arn = "arn:aws:iam::${local.account}:oidc-provider/token.actions.githubusercontent.com"
}

resource "aws_iam_role" "terraform" {
  name                 = "TinyCivGitHubTerraform"
  max_session_duration = 7200
  tags                 = local.tags
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:tinyciv@352986322/tinyciv.github.io@1447778810:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role" "cloudformation" {
  name = "TinyCivCloudFormation"
  tags = local.tags
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudformation.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "terraform" {
  name = "ManageTinyCivInfrastructure"
  role = aws_iam_role.terraform.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListState"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.state.arn
        Condition = {
          StringLike = { "s3:prefix" = ["production/*", "env:/"] }
        }
      },
      {
        Sid      = "ReadWriteProductionState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.state.arn}/production/terraform.tfstate"
      },
      {
        Sid      = "LockProductionState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.state.arn}/production/terraform.tfstate.tflock"
      },
      {
        Sid    = "ManageGameStack"
        Effect = "Allow"
        Action = [
          "cloudformation:CreateStack", "cloudformation:UpdateStack",
          "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
          "cloudformation:DescribeStackResources", "cloudformation:GetTemplate",
          "cloudformation:GetStackPolicy", "cloudformation:SetStackPolicy",
          "cloudformation:ListStackResources"
        ]
        Resource = local.stack_arn
      },
      {
        Sid      = "ValidateTemplate"
        Effect   = "Allow"
        Action   = "cloudformation:ValidateTemplate"
        Resource = "*"
      },
      {
        Sid      = "PassOnlyGameStackRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.cloudformation.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "cloudformation.amazonaws.com" }
        }
      },
      {
        Sid      = "UpdateApplicationReleasePolicy"
        Effect   = "Allow"
        Action   = ["iam:GetRolePolicy", "iam:PutRolePolicy"]
        Resource = "arn:aws:iam::${local.account}:role/TinyCivGitHubDeploy"
      },
      {
        Sid      = "ManageGameInstanceDatabasePolicy"
        Effect   = "Allow"
        Action   = ["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
        Resource = "arn:aws:iam::${local.account}:role/btv-multiplayer-*"
      },
      {
        Sid    = "ManageAccountDatabase"
        Effect = "Allow"
        Action = [
          "rds:CreateDBInstance", "rds:ModifyDBInstance", "rds:DescribeDBInstances",
          "rds:CreateDBSubnetGroup", "rds:ModifyDBSubnetGroup", "rds:DescribeDBSubnetGroups", "rds:DeleteDBSubnetGroup",
          "rds:CreateDBParameterGroup", "rds:ModifyDBParameterGroup", "rds:DescribeDBParameterGroups",
          "rds:DescribeDBParameters", "rds:DeleteDBParameterGroup", "rds:AddTagsToResource",
          "rds:RemoveTagsFromResource", "rds:ListTagsForResource"
        ]
        Resource = [
          "arn:aws:rds:${local.region}:${local.account}:db:tinyciv-accounts",
          "arn:aws:rds:${local.region}:${local.account}:subgrp:tinyciv-accounts",
          "arn:aws:rds:${local.region}:${local.account}:pg:tinyciv-accounts-*"
        ]
      },
      {
        Sid       = "InspectAccountDatabaseNetwork"
        Effect    = "Allow"
        Action    = ["ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules", "ec2:DescribeSubnets", "ec2:DescribeVpcs"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = local.region } }
      },
      {
        Sid       = "CreateAccountDatabaseFirewall"
        Effect    = "Allow"
        Action    = ["ec2:CreateSecurityGroup", "ec2:CreateTags"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = local.region } }
      },
      {
        Sid       = "ManageTaggedAccountDatabaseFirewall"
        Effect    = "Allow"
        Action    = ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress", "ec2:ModifySecurityGroupRules", "ec2:DeleteSecurityGroup", "ec2:DeleteTags"]
        Resource  = "arn:aws:ec2:${local.region}:${local.account}:*/*"
        Condition = { StringEquals = { "ec2:ResourceTag/Component" = "Accounts" } }
      },
      {
        Sid    = "ManageDatabaseSecretContainers"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DescribeSecret",
          "secretsmanager:UpdateSecret", "secretsmanager:DeleteSecret",
          "secretsmanager:TagResource", "secretsmanager:UntagResource"
        ]
        Resource = [
          "arn:aws:secretsmanager:${local.region}:${local.account}:secret:tinyciv/accounts/*",
          "arn:aws:secretsmanager:${local.region}:${local.account}:secret:rds!*"
        ]
      },
      {
        Sid      = "DescribeManagedDatabaseKeys"
        Effect   = "Allow"
        Action   = "kms:DescribeKey"
        Resource = "arn:aws:kms:${local.region}:${local.account}:key/*"
      },
      {
        Sid      = "ManageDatabaseConfiguration"
        Effect   = "Allow"
        Action   = ["ssm:PutParameter", "ssm:GetParameter", "ssm:DeleteParameter", "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:ListTagsForResource"]
        Resource = "arn:aws:ssm:${local.region}:${local.account}:parameter/tinyciv/accounts/database"
      },
      {
        Sid       = "CreateRdsServiceRole"
        Effect    = "Allow"
        Action    = "iam:CreateServiceLinkedRole"
        Resource  = "arn:aws:iam::${local.account}:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS"
        Condition = { StringEquals = { "iam:AWSServiceName" = "rds.amazonaws.com" } }
      }
    ]
  })
}

output "aws_terraform_role_arn" {
  description = "Set the GitHub repository Actions variable AWS_TERRAFORM_ROLE_ARN to this value."
  value       = aws_iam_role.terraform.arn
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}
