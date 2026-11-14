locals {
  secgrp_lambda_name = "secgrp-lbd-${var.project_name}-customer-auth"
  cw_lg_lambda_name  = "/aws/lambda/${var.function_name}"

  vpc_id             = data.terraform_remote_state.aws_base.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.aws_base.outputs.private_subnet_ids

  nlb_dns_name           = data.terraform_remote_state.k8s.outputs.nlb_dns_name
  service_listener_ports = data.terraform_remote_state.k8s.outputs.service_listener_ports

  api_execution_arn = data.terraform_remote_state.gateway.outputs.api_execution_arn
  api_endpoint      = data.terraform_remote_state.gateway.outputs.api_endpoint

  jwt_private_key_secret_name = "${var.project_name}/customer-auth/jwt-private-key"

  base_environment = {
    NODE_ENV = "production"

    IDENTITY_INTERNAL_URL   = "http://${local.nlb_dns_name}:${local.service_listener_ports["identity"]}"
    WORK_ORDER_INTERNAL_URL = "http://${local.nlb_dns_name}:${local.service_listener_ports["work-order"]}"

    CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID = aws_secretsmanager_secret.jwt_private_key.arn

    NODE_OPTIONS = "--enable-source-maps"

    SERVICE_VERSION = var.service_version
  }

  telemetry_environment = var.enable_telemetry_collection ? {
    DD_API_KEY = var.telemetry_api_key
    DD_SITE    = var.telemetry_site
    DD_ENV     = "production"
    DD_SERVICE = "oficina-mecanica-lambda-customer-auth"
    DD_VERSION = var.service_version

    DD_SERVERLESS_LOGS_ENABLED = "true"
    DD_TRACE_ENABLED           = "false"
  } : {}

  telemetry_layer_arn = "arn:aws:lambda:${data.aws_region.current.region}:${var.telemetry_extension_layer_account_id}:layer:${var.telemetry_extension_layer_name}:${var.telemetry_extension_layer_version}"

  lambda_layers = var.enable_telemetry_collection ? [local.telemetry_layer_arn] : []
}
