# This role is used only by the btv-multiplayer stack. Extend these permissions
# when adding a new AWS service to the template; never grant CI administrator.
resource "aws_iam_role_policy" "cloudformation" {
  name = "ManageGameResources"
  role = aws_iam_role.cloudformation.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CloudFront checks these dependent read permissions in its global
        # request context, even when the origin instance is in Oregon.
        Sid      = "InspectCloudFrontVpcOriginPrerequisites"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances", "ec2:DescribeInternetGateways", "elasticloadbalancing:DescribeLoadBalancers"]
        Resource = "*"
      },
      {
        Sid    = "InspectOregonNetwork"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances", "ec2:DescribeInstanceStatus", "ec2:DescribeImages",
          "ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules",
          "ec2:DescribeSubnets", "ec2:DescribeVpcs", "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeVolumes", "ec2:DescribeTags", "ec2:DescribeInstanceAttribute",
          "ec2:DescribeInstanceCreditSpecifications", "ec2:DescribeIamInstanceProfileAssociations"
        ]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = local.region } }
      },
      {
        Sid       = "CreateGameHostAndSecurityGroup"
        Effect    = "Allow"
        Action    = ["ec2:RunInstances", "ec2:CreateSecurityGroup", "ec2:CreateTags"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = local.region } }
      },
      {
        Sid    = "ManageTaggedGameCompute"
        Effect = "Allow"
        Action = [
          "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances",
          "ec2:TerminateInstances", "ec2:ModifyInstanceAttribute",
          "ec2:ModifyInstanceCreditSpecification", "ec2:ModifyInstanceMetadataOptions",
          "ec2:AssociateIamInstanceProfile", "ec2:ReplaceIamInstanceProfileAssociation",
          "ec2:DisassociateIamInstanceProfile", "ec2:DeleteTags",
          "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress",
          "ec2:DeleteSecurityGroup"
        ]
        Resource  = "arn:aws:ec2:${local.region}:${local.account}:*/*"
        Condition = { StringEquals = { "ec2:ResourceTag/Project" = "BTV" } }
      },
      {
        Sid    = "ManageGameReleaseBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:GetBucketLocation",
          "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
          "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:GetBucketPublicAccessBlock",
          "s3:PutBucketPublicAccessBlock", "s3:GetBucketOwnershipControls",
          "s3:PutBucketOwnershipControls", "s3:GetEncryptionConfiguration",
          "s3:PutEncryptionConfiguration", "s3:GetLifecycleConfiguration",
          "s3:PutLifecycleConfiguration"
        ]
        Resource = "arn:aws:s3:::btv-multiplayer-*"
      },
      {
        Sid    = "ManageStackInstanceIdentity"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:GetRole", "iam:DeleteRole", "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
          "iam:ListRoleTags", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
          "iam:CreateInstanceProfile", "iam:GetInstanceProfile", "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
          "iam:TagInstanceProfile", "iam:UntagInstanceProfile", "iam:ListInstanceProfileTags"
        ]
        Resource = [
          "arn:aws:iam::${local.account}:role/btv-multiplayer-*",
          "arn:aws:iam::${local.account}:instance-profile/btv-multiplayer-*"
        ]
      },
      {
        Sid      = "AttachOnlySsmManagedPolicy"
        Effect   = "Allow"
        Action   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        Resource = "arn:aws:iam::${local.account}:role/btv-multiplayer-*"
        Condition = {
          ArnEquals = { "iam:PolicyARN" = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" }
        }
      },
      {
        Sid      = "PassOnlyGameInstanceRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:aws:iam::${local.account}:role/btv-multiplayer-*"
        Condition = {
          StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
        }
      },
      {
        # CloudFront create/list operations need wildcard resources. The
        # distribution and private origin are global, unlike EC2 and S3.
        Sid    = "ManageCloudFrontHosting"
        Effect = "Allow"
        Action = [
          "cloudfront:CreateDistribution", "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution", "cloudfront:CreateVpcOrigin",
          "cloudfront:GetVpcOrigin", "cloudfront:UpdateVpcOrigin", "cloudfront:DeleteVpcOrigin",
          "cloudfront:CreateCachePolicy", "cloudfront:GetCachePolicy",
          "cloudfront:GetCachePolicyConfig", "cloudfront:UpdateCachePolicy", "cloudfront:DeleteCachePolicy",
          "cloudfront:CreateOriginRequestPolicy", "cloudfront:GetOriginRequestPolicy",
          "cloudfront:GetOriginRequestPolicyConfig", "cloudfront:UpdateOriginRequestPolicy",
          "cloudfront:DeleteOriginRequestPolicy", "cloudfront:ListTagsForResource",
          "cloudfront:TagResource", "cloudfront:UntagResource"
        ]
        Resource = "*"
      }
    ]
  })
}
