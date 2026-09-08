resource "aws_secretsmanager_secret" "jwt_private_key" {
  name        = local.jwt_private_key_secret_name
  description = "PEM PKCS#8 da metade privada do par que assina o token externo de cliente"

  recovery_window_in_days = 0

  tags = {
    Name = local.jwt_private_key_secret_name
  }
}
