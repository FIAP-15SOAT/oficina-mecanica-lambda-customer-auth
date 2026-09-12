# Grupo de seguranca da funcao.
#
# Sem regra de ingresso: nada conecta na função — ela é invocada pelo API Gateway,
# por chamada de serviço, e não por rede. O egresso é liberado porque a função
# alcança banco, gerenciador de segredos e destino de telemetria, os dois
# últimos pelo gateway de tradução de rede que já existe nas rotas privadas.
resource "aws_security_group" "secgrp_lambda" {
  name = local.secgrp_lambda_name
  # O EC2 recusa a descricao de um security group fora de ASCII.
  description = "Egress for the external customer authentication function"
  vpc_id      = local.vpc_id

  egress {
    description      = "Egresso liberado: banco, gerenciador de segredos e destino de telemetria"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = local.secgrp_lambda_name
  }
}
