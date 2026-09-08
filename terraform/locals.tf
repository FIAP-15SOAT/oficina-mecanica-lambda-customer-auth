locals {
  secgrp_lambda_name = "secgrp-lbd-${var.project_name}-customer-auth"
  cw_lg_lambda_name  = "/aws/lambda/${var.function_name}"

  vpc_id             = data.terraform_remote_state.aws_base.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.aws_base.outputs.private_subnet_ids

  db_host = data.terraform_remote_state.database.outputs.db_host
  db_port = data.terraform_remote_state.database.outputs.db_port
  db_name = data.terraform_remote_state.database.outputs.db_name

  db_credentials_secret_arn = data.terraform_remote_state.database.outputs.db_credentials_secret_arn

  api_execution_arn = data.terraform_remote_state.gateway.outputs.api_execution_arn
  api_endpoint      = data.terraform_remote_state.gateway.outputs.api_endpoint

  jwt_private_key_secret_name = "${var.project_name}/customer-auth/jwt-private-key"

  base_environment = {
    NODE_ENV = "production"

    DATABASE_HOST = local.db_host
    DATABASE_PORT = tostring(local.db_port)
    DATABASE_NAME = local.db_name

    DATABASE_SECRET_ID                 = local.db_credentials_secret_arn
    CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID = aws_secretsmanager_secret.jwt_private_key.arn

    NODE_EXTRA_CA_CERTS = var.node_extra_ca_certs
    NODE_OPTIONS        = "--enable-source-maps"

    SERVICE_VERSION = var.service_version
  }

  telemetry_environment = var.enable_telemetry_collection ? {
    DD_API_KEY = var.telemetry_api_key
    DD_SITE    = var.telemetry_site
    DD_ENV     = var.environment
    DD_SERVICE = "oficina-mecanica-lambda-customer-auth"
    DD_VERSION = var.service_version

    DD_SERVERLESS_LOGS_ENABLED = "true"
    DD_TRACE_ENABLED           = "false"
  } : {}

  telemetry_layer_arn = "arn:aws:lambda:${data.aws_region.current.region}:${var.telemetry_extension_layer_account_id}:layer:${var.telemetry_extension_layer_name}:${var.telemetry_extension_layer_version}"

  lambda_layers = var.enable_telemetry_collection ? [local.telemetry_layer_arn] : []
}
