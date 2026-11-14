# ADR 0007: Credencial e vínculo verificados nos serviços donos

## Status

Aceito — 2026-11-14

Substitui o [ADR 0001](0001-driver-em-vez-de-orm.md) e emenda o
[ADR 0003](0003-bcrypt-em-javascript-puro.md).

## Contexto

Para decidir um login, a função precisa saber quatro coisas: se existe usuário
com o CPF, se a conta está ativa, se a senha confere e se o usuário tem ao menos
um vínculo com cliente ativo. Até aqui ela lia essas quatro respostas direto do
banco PostgreSQL do work-order, o serviço das ordens de serviço, com o driver
`pg` e uma consulta escrita à mão ([ADR 0001](0001-driver-em-vez-de-orm.md)), e
comparava a senha com o hash usando bcrypt em JavaScript puro
([ADR 0003](0003-bcrypt-em-javascript-puro.md)).

A solução passou a ter dois donos para esses dados:

- o **Identity**, serviço que guarda os usuários e as senhas, e que expõe
  `POST /internal/customer-authentications`: recebe CPF e senha e responde
  `200 { data: { userId } }` ou `401`, o mesmo para CPF inexistente, conta
  inativa e senha incorreta;
- o **work-order**, que guarda os clientes e os vínculos entre usuário e
  cliente, e que expõe `GET /internal/users/:userId/customers`, a lista dos
  clientes ativos vinculados ao usuário.

A regra da solução é que cada serviço seja o único cliente do próprio banco:
ninguém lê nem escreve no banco de outro serviço, e ninguém replica entidades
dele. A leitura direta da função contrariava essa regra e só funcionava com uma
regra de rede provisória, que liberava a porta 5432 do RDS (o banco gerenciado da
AWS) do work-order para as subnets privadas, e com a credencial do banco
entregue à função.

## Decisão

A função pergunta a cada dono o que é dele, pelas rotas internas, através do
NLB (Network Load Balancer, o balanceador de rede interno do cluster Kubernetes
onde os serviços rodam):

1. o CPF normalizado e a senha vão ao Identity; `401` é recusa da credencial;
2. com o `userId` recebido, a função pede ao work-order os clientes ativos do
   usuário; lista vazia é recusa;
3. com os dois aceitos, a função assina o token, como antes.

As chamadas usam o `axios`, o mesmo cliente HTTP dos serviços, com tempo limite
de 2 s, sem seguir redirect e com conexão nova a cada chamada. A conexão nova é
deliberada: o ambiente da função congela entre invocações e os serviços fecham a
conexão ociosa depois de 5 s, então uma conexão reaproveitada pode já estar
fechada quando a invocação seguinte a usa. Qualquer falha de chamada — tempo
esgotado, conexão recusada, redirect, 5xx ou 4xx que não seja o `401` do
Identity — responde `503`.

A recusa continua idêntica para as quatro causas. A função registra a etapa
(`credential_refused` ou `no_active_customer_link`); a causa da recusa da
credencial fica no log do Identity.

Saem o driver `pg`, o `bcryptjs`, a leitura do segredo do banco, as variáveis
`DATABASE_*`, a variável `NODE_EXTRA_CA_CERTS` (que só existia para o TLS do RDS)
e o state remoto da stack de banco. A stack passa a ler o state remoto do
cluster, de onde monta `IDENTITY_INTERNAL_URL` e `WORK_ORDER_INTERNAL_URL`. A
memória cai de 1024 MB, dimensionados para o bcrypt, para 256 MB.

### O que muda no ADR 0003

A primeira decisão do ADR 0003 — bcrypt em JavaScript puro — deixa de existir:
a função não verifica mais senha, e o bcrypt roda no Identity. As outras duas
continuam de pé: o artefato compactado, que segue sem código nativo, e a
execução local por invocação avulsa, que agora usa um stub local (`npm run stub`,
um servidor HTTP de teste que imita as rotas internas dos dois serviços) no
lugar do banco.

## Alternativas descartadas

| Alternativa | Por que não | Rever se |
| --- | --- | --- |
| Manter a leitura direta do banco do work-order | Contraria a regra de dono único do banco, mantém a regra de rede provisória até o RDS e a credencial do banco na função, e quebra quando os usuários saem do banco do work-order para o do Identity | — |
| Réplica dos usuários e dos vínculos na função, alimentada por eventos | Copia entidades de outros serviços, exige sincronização e um armazenamento próprio numa função hoje sem estado, e ainda verifica senha fora do dono | O Identity ou o work-order não aguentarem a carga de logins com a concorrência reservada |
| Chamar só o Identity e deixar o vínculo para o work-order no primeiro uso do token | O login aceitaria um cliente sem vínculo ativo e emitiria um token que nenhuma rota `/api/me/**` aceita, mudando o contrato público de login | — |
| Reaproveitar conexões entre invocações (keep-alive) | Uma conexão fechada pelo serviço enquanto o ambiente estava congelado faz o primeiro login depois de um tempo parado responder `503`, sem retry | A latência de abrir as duas conexões aparecer no p95 do login; nesse caso, com retry na conexão reaproveitada |

## Consequências

**Positivas.** A função não acessa banco algum, e a regra de rede provisória até
o RDS pode sair. Cada dado é lido de quem é dono dele, com o contrato que o dono
publica e testa. O pacote perde o driver e o bcrypt, e a memória cai para 256 MB.
O contrato público de login e o token não mudam.

**Negativas.** O login passa a depender, de forma síncrona, de dois serviços:
com o Identity ou o work-order fora do ar, responde `503`. Cada login faz duas
idas de rede dentro da VPC, mais a abertura de duas conexões. As chamadas
internas não levam credencial de serviço — a proteção das rotas `/internal/...` é
a fronteira de rede, como entre os serviços. A diferença de tempo entre as causas
de recusa continua, agora determinada pela ordem de avaliação do Identity.

**Verificação.** Os testes de ponta a ponta rodam contra um stub que responde com
as fixtures publicadas pelos dois serviços — arquivos JSON com uma resposta de
exemplo de cada rota —, e a entrega termina com o login de um cliente semeado
cujo token o work-order precisa aceitar.

## Referências

- [Contrato › Chamadas internas](../contracts.md#chamadas-internas)
- [Arquitetura › Gateways e o cliente HTTP interno](../architecture.md#gateways-e-o-cliente-http-interno)
- [Testes › Ponta a ponta](../testing.md#ponta-a-ponta--npm-run-teste2e)
- [CI/CD › Os três portões pós-implantação](../ci-cd.md#os-três-portões-pós-implantação)
