variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "oficina-mecanica"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod-simulated"
}

# ---------------------------------------------------------------------------
# Remote state inputs
# ---------------------------------------------------------------------------

variable "aws_base_state_bucket" {
  description = "S3 bucket name that stores the infra-base Terraform state"
  type        = string
  default     = "bkt-oficina-mecanica"
}

variable "aws_base_state_key" {
  description = "S3 object key for the infra-base Terraform state (source of vpc_id and private_subnet_ids)"
  type        = string
  default     = "infra/prod-simulated/infra-base/terraform.tfstate"
}

variable "aws_base_state_region" {
  description = "AWS region of the infra-base state bucket"
  type        = string
  default     = "us-east-1"
}

variable "database_state_bucket" {
  description = "S3 bucket name that stores the database Terraform state"
  type        = string
  default     = "bkt-oficina-mecanica"
}

variable "database_state_key" {
  description = "S3 object key for the database Terraform state (source of db_host, db_port, db_name and db_credentials_secret_arn)"
  type        = string
  default     = "infra/prod-simulated/database/terraform.tfstate"
}

variable "database_state_region" {
  description = "AWS region of the database state bucket"
  type        = string
  default     = "us-east-1"
}

variable "gateway_state_bucket" {
  description = "S3 bucket name that stores the gateway Terraform state"
  type        = string
  default     = "bkt-oficina-mecanica"
}

variable "gateway_state_key" {
  description = "S3 object key for the gateway Terraform state (source of api_execution_arn and api_endpoint)"
  type        = string
  default     = "infra/prod-simulated/gateway/terraform.tfstate"
}

variable "gateway_state_region" {
  description = "AWS region of the gateway state bucket"
  type        = string
  default     = "us-east-1"
}

# ---------------------------------------------------------------------------
# Function
# ---------------------------------------------------------------------------

variable "function_name" {
  description = "Function name. It is a contract with the API Gateway, which builds the invoke address from it"
  type        = string
  default     = "lbd-oficina-mecanica-customer-auth"
}

variable "lambda_execution_role_name" {
  description = "Name of the **pre-existing** execution role in the account"
  type        = string
  default     = "LabRole"
}

variable "lambda_runtime" {
  description = "Function runtime"
  type        = string
  default     = "nodejs24.x"
}

variable "lambda_memory_size" {
  description = "Memory in MB. On the platform memory is also the CPU control"
  type        = number
  default     = 1024
}

variable "lambda_timeout" {
  description = "Timeout in seconds"
  type        = number
  default     = 15
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrency. Use -1 when the account quota does not allow any reservation; never zero"
  type        = number
  default     = 10

  validation {
    condition     = var.lambda_reserved_concurrency == -1 || var.lambda_reserved_concurrency > 0
    error_message = "A zero reservation disables the function entirely: use a positive value, or -1 for no reservation."
  }
}

variable "log_retention_in_days" {
  description = "Log group retention, in days"
  type        = number
  default     = 14
}

variable "node_extra_ca_certs" {
  description = "Path to the certificate authority bundle the runtime image already ships"
  type        = string
  default     = "/etc/pki/tls/certs/ca-bundle.crt"
}

variable "service_version" {
  description = "Deployed commit SHA. Feeds the service.version attribute the structured logger already emits"
  type        = string
  default     = "dev"
}

# ---------------------------------------------------------------------------
# Telemetry collection
# ---------------------------------------------------------------------------

variable "enable_telemetry_collection" {
  description = "Turns the telemetry collection layer on. When off, the function is provisioned and runs without it"
  type        = bool
  default     = false
}

variable "telemetry_api_key" {
  description = "Telemetry destination API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "telemetry_site" {
  description = "Telemetry destination site"
  type        = string
  default     = "us5.datadoghq.com"
}

variable "telemetry_extension_layer_account_id" {
  description = "Account that publishes the platform telemetry collection layer"
  type        = string
  default     = "464622532012"
}

variable "telemetry_extension_layer_name" {
  description = "Name of the platform telemetry collection layer"
  type        = string
  default     = "Datadog-Extension"
}

variable "telemetry_extension_layer_version" {
  description = "Version of the telemetry collection layer"
  type        = number
  default     = 99
}
