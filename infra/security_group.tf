# Function security group.
#
# No ingress rule: nothing connects to the function — it is invoked by API Gateway,
# through a service call, not over the network. Egress is open because the function
# reaches the database, the secrets manager and the telemetry destination, the last
# two through the network address translation gateway already in the private routes.
resource "aws_security_group" "secgrp_lambda" {
  name = local.secgrp_lambda_name
  # EC2 refuses a security group description outside ASCII.
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
