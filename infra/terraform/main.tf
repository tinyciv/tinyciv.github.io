locals {
  # CloudFormation continues owning its child resources. Terraform owns the
  # stack, so existing physical IDs and application release tooling stay intact.
  template = jsondecode(file("${path.module}/../multiplayer.template.json"))
  rendered_template = merge(local.template, {
    Resources = merge(local.template.Resources, {
      GameServer = merge(local.template.Resources.GameServer, {
        Properties = merge(local.template.Resources.GameServer.Properties, {
          UserData = { "Fn::Base64" = file("${path.module}/../bootstrap-multiplayer.sh") }
        })
      })
    })
  })
}

# Adopt the running stack rather than creating another server/distribution.
import {
  to = aws_cloudformation_stack.multiplayer
  id = "btv-multiplayer"
}

resource "aws_cloudformation_stack" "multiplayer" {
  name          = "btv-multiplayer"
  template_body = jsonencode(local.rendered_template)
  capabilities  = ["CAPABILITY_IAM"]
  iam_role_arn  = "arn:aws:iam::780705957578:role/TinyCivCloudFormation"

  parameters = {
    VpcId                          = "vpc-b000bdd5"
    SubnetId                       = "subnet-239e3554"
    CloudFrontServiceSecurityGroup = "sg-06e81587caba552e4"
    AmiId                          = var.ami_id
    InstanceType                   = var.instance_type
  }

  tags = {
    Project   = "BTV"
    Component = "Multiplayer"
    ManagedBy = "Terraform"
  }

  # Retain the public address, release archive and running host during routine
  # changes. Intentional replacements need an explicit stack-policy change.
  policy_body = jsonencode({
    Statement = [
      {
        Effect    = "Allow"
        Principal = "*"
        Action    = "Update:*"
        Resource  = "*"
      },
      {
        Effect    = "Deny"
        Principal = "*"
        Action    = ["Update:Replace", "Update:Delete"]
        Resource  = ["LogicalResourceId/GameServer", "LogicalResourceId/ReleaseBucket", "LogicalResourceId/Distribution", "LogicalResourceId/PrivateOrigin"]
      }
    ]
  })

  lifecycle {
    prevent_destroy = true
  }

  timeouts {
    create = "60m"
    update = "60m"
  }
}

# The application deployment role follows stack outputs if resources change.
# Its trust remains owned by the existing administrator bootstrap.
import {
  to = aws_iam_role_policy.application_deploy
  id = "TinyCivGitHubDeploy:DeployExistingTinyCivServer"
}

resource "aws_iam_role_policy" "application_deploy" {
  name = "DeployExistingTinyCivServer"
  role = "TinyCivGitHubDeploy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadExistingGameStack"
        Effect   = "Allow"
        Action   = "cloudformation:DescribeStacks"
        Resource = aws_cloudformation_stack.multiplayer.id
      },
      {
        Sid      = "UploadReleaseBundle"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]
        Resource = "arn:aws:s3:::${aws_cloudformation_stack.multiplayer.outputs.ReleaseBucket}/releases/*"
      },
      {
        Sid    = "InstallOnExistingGameServer"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ssm:us-west-2::document/AWS-RunShellScript",
          "arn:aws:ec2:us-west-2:780705957578:instance/${aws_cloudformation_stack.multiplayer.outputs.InstanceId}"
        ]
      },
      {
        Sid      = "ReadCommandAndAgentStatus"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-west-2" }
        }
      },
      {
        Sid      = "VerifyDeploymentAccount"
        Effect   = "Allow"
        Action   = "sts:GetCallerIdentity"
        Resource = "*"
      }
    ]
  })
}
