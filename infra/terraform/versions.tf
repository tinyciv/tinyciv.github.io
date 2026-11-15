terraform {
  required_version = "~> 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket              = "tinyciv-terraform-780705957578-us-west-2"
    key                 = "production/terraform.tfstate"
    region              = "us-west-2"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["780705957578"]
  }
}

provider "aws" {
  region              = "us-west-2"
  allowed_account_ids = ["780705957578"]
}
