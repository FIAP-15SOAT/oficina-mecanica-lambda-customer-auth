resource "aws_lambda_function" "customer_auth" {
  function_name = var.function_name
  description   = "Autenticação externa de clientes"

  role = data.aws_iam_role.lambda_execution.arn

  filename         = data.archive_file.package.output_path
  source_code_hash = data.archive_file.package.output_base64sha256

  runtime = var.lambda_runtime
  handler = "handler.handler"

  memory_size = var.lambda_memory_size
  timeout     = var.lambda_timeout

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  vpc_config {
    subnet_ids         = local.private_subnet_ids
    security_group_ids = [aws_security_group.secgrp_lambda.id]
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.cw_lg_lambda.name
  }

  layers = local.lambda_layers

  environment {
    variables = merge(local.base_environment, local.telemetry_environment)
  }

  publish = true

  tags = {
    Name           = var.function_name
    ServiceVersion = var.service_version
  }

  depends_on = [aws_cloudwatch_log_group.cw_lg_lambda]
}

resource "aws_lambda_permission" "allow_api_gateway" {
  statement_id   = "AllowInvokeFromHttpApi"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.customer_auth.function_name
  principal      = "apigateway.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id

  source_arn = "${local.api_execution_arn}/*/POST/customer-auth/login"
}
