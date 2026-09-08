data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "terraform_remote_state" "aws_base" {
  backend = "s3"

  config = {
    bucket = var.aws_base_state_bucket
    key    = var.aws_base_state_key
    region = var.aws_base_state_region
  }
}

data "terraform_remote_state" "database" {
  backend = "s3"

  config = {
    bucket = var.database_state_bucket
    key    = var.database_state_key
    region = var.database_state_region
  }
}

data "terraform_remote_state" "gateway" {
  backend = "s3"

  config = {
    bucket = var.gateway_state_bucket
    key    = var.gateway_state_key
    region = var.gateway_state_region
  }
}

data "aws_iam_role" "lambda_execution" {
  name = var.lambda_execution_role_name
}

data "archive_file" "package" {
  type             = "zip"
  source_dir       = "${path.module}/../app/dist"
  output_path      = "${path.module}/build/handler.zip"
  output_file_mode = "0644"
}
