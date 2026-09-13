output "function_name" {
  description = "Nome da função"
  value       = aws_lambda_function.customer_auth.function_name
}

output "function_arn" {
  description = "ARN da função"
  value       = aws_lambda_function.customer_auth.arn
}

output "function_invoke_arn" {
  description = "Endereço de invocação da função."
  value       = aws_lambda_function.customer_auth.invoke_arn
}

output "function_version" {
  description = "Versão imutável publicada por esta aplicação."
  value       = aws_lambda_function.customer_auth.version
}

output "jwt_private_key_secret_arn" {
  description = "Identificador do segredo da chave privada de assinatura. O contêiner é declarado aqui; o valor é escrito pela entrega."
  value       = aws_secretsmanager_secret.jwt_private_key.arn
}

output "log_group_name" {
  description = "Grupo de log da função."
  value       = aws_cloudwatch_log_group.cw_lg_lambda.name
}

output "api_endpoint" {
  description = "Endereço público do api gateway"
  value       = local.api_endpoint
}
