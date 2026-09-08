# Infraestrutura

A stack desta função vive em `terraform/`, no mesmo repositório do código: o que
muda junto fica junto, e a configuração da função passa pelo mesmo ciclo de
revisão que ela.

![Diagrama de arquitetura: o cliente chama por HTTPS o API Gateway, que publica
POST /customer-auth/login e invoca a função Lambda; a função executa nas duas
subnets privadas da VPC 10.0.0.0/16, com security group próprio e interface de
rede criada na partida a frio, alcança o Amazon RDS PostgreSQL 16 na porta 5432
e o Secrets Manager pelo NAT Gateway, e emite log para o CloudWatch Logs com
retenção de 14 dias](diagrams/infrastructure.png)

## O que esta stack provisiona

| Recurso | Dono | Por que aqui |
| --- | --- | --- |
| Função | **este repositório** | O artefato e a sua configuração pertencem ao mesmo ciclo de revisão |
| Grupo de segurança da função | **este repositório** | Nasce e morre com a função |
| Autorização de invocação concedida ao API Gateway | **este repositório** | Sem ela a rota responde erro de integração com a função saudável — e nenhuma outra stack a declara |
| Grupo de log da função | **este repositório** | Sem declaração, a plataforma o cria com retenção indefinida |
| Contêiner do segredo da chave privada de assinatura | **este repositório** | O material é da função; o **valor** é escrito pela entrega |
| Rede, subnets, gateway de tradução | `oficina-mecanica-infra-base` | Consumido por leitura de state remoto |
| Banco, seu grupo de segurança e o segredo da credencial | `oficina-mecanica-database` | Quem é dono do recurso é dono da credencial |
| API Gateway, rota e limitação de frequência | `oficina-mecanica-gateway` | A rota é publicada lá; esta stack apenas autoriza a invocação |
| Cluster, registro de imagens e balanceador | `oficina-mecanica-k8s` | Não participa desta função |
| Bucket do state | compartilhado, pré-existente | Já existe e serve as cinco stacks. **Esta acrescenta apenas uma chave** |
| Qualquer role de identidade | **ninguém** — o laboratório não permite criar roles | A role de execução é lida por fonte de dados, nunca criada |

## Estado remoto

Endereço, porta e nome do banco, identificadores de subnet e o identificador de
execução da API vêm do state das stacks que os possuem. Nada disso é digitado
como variável.

| Origem | Chave do state | O que esta stack lê |
| --- | --- | --- |
| `infra-base` | `infra/prod-simulated/infra-base/terraform.tfstate` | `vpc_id`, `private_subnet_ids` |
| `database` | `infra/prod-simulated/database/terraform.tfstate` | `db_host`, `db_port`, `db_name`, `db_credentials_secret_arn` |
| `gateway` | `infra/prod-simulated/gateway/terraform.tfstate` | `api_execution_arn`, `api_endpoint` |

## Backend

```hcl
bucket       = "bkt-oficina-mecanica"
key          = "infra/prod-simulated/lambda-customer-auth/terraform.tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
```

Cifração em repouso e trava por arquivo de bloqueio no próprio armazenamento de
objetos — as mesmas opções das outras quatro stacks, sem tabela auxiliar.

O arquivo de bloqueio de provedores (`.terraform.lock.hcl`) é versionado, como
nas demais stacks da solução, e cobre `linux_amd64` — a esteira —, `windows_amd64`
e `darwin_arm64` — as estações de trabalho.

## Ordem de aplicação

```
infra-base  →  database  →  gateway  →  lambda-customer-auth
```

A autorização de invocação declarada aqui restringe pelo identificador de
execução da API, lido do state remoto daquela stack: o API Gateway vem antes.

**O segredo da credencial do banco é pré-requisito, não consequência.** A stack
de banco expõe o identificador desse segredo pelo output
`db_credentials_secret_arn`. Sem ele, a leitura do state remoto reprova por
atributo inexistente e **nenhum recurso desta stack chega a ser planejado**.

## Configuração da função

| Parâmetro | Valor | Motivo |
| --- | --- | --- |
| Ambiente de execução | `nodejs24.x` | Versão de longo prazo; casa com o motor declarado pelo projeto e com o alvo da construção |
| Ponto de entrada | `handler.handler` | Arquivo único na raiz do pacote, saída da construção |
| Arquitetura | a padrão | A alternativa é ~20% mais barata e o algoritmo de hash é puro, mas mudaria o endereço da camada de coleta. Uma peça móvel a menos vale mais que a diferença |
| Memória | **1024 MB** | **A memória é o controle de processador.** A verificação de senha é limitada por processador; com pouca memória ela passa a dominar a latência. Como a cobrança é tempo × memória, dobrar num trabalho limitado por processador é aproximadamente neutro em custo. É valor de partida: a linha de invocação reporta a duração da verificação, e o ajuste fino se faz com esse dado |
| Tempo limite | **15 s** | O teto de integração do API Gateway é 30 s. Os limites internos somam ~8 s, então 15 s dá quase o dobro de folga e **reduz pela metade** o tempo que uma invocação pendurada retém um lugar da concorrência reservada |
| Concorrência reservada | **10**, por variável | Cada ambiente mantém uma conexão. A instância comporta ~110 conexões e a API vai a cinco réplicas com pool próprio; 10 usa menos de um décimo do orçamento |
| Formato de log | **texto** | O formato estruturado da plataforma **embrulha** a saída capturada num envelope próprio, quebrando o contrato de esquema fechado |
| Retenção do grupo de log | 14 dias | Mesma do log de acesso do API Gateway |
| Publicação de versão | ligada | Versão imutável a cada aplicação. Sem apelido |
| Rede | subnets privadas, grupo de segurança próprio | O banco não é publicamente acessível e aceita apenas origens da faixa da rede |

**A reserva de concorrência pode ser recusada pela conta.** A plataforma exige
que sobrem ao menos cem execuções não reservadas, e contas novas recebem cota
reduzida. Por isso o valor é variável e a fase de pré-requisitos o verifica antes
de qualquer aplicação. O caminho de contorno é `lambda_reserved_concurrency = -1`
— não reservar. **O valor nunca é zero**: reserva zero desliga a função por completo, e a variável recusa
esse valor.

O grupo de segurança não declara regra de ingresso: nada conecta na função — ela
é invocada por chamada de serviço, não por rede. O egresso é liberado, e alcança
o gerenciador de segredos e o destino de telemetria pelo gateway de tradução de
rede que já existe nas rotas privadas, com custo incremental zero.

## Variáveis de ambiente da função

O esquema de configuração da aplicação **recusa a partida** quando falta
qualquer obrigatória, e a falha ocorre na composição — antes de qualquer
processamento —, de modo que **toda** invocação responderia erro interno. Por
isso a stack declara o conjunto completo, e não apenas o que a esteira injeta.

| Variável | Origem | Observação |
| --- | --- | --- |
| `NODE_ENV` | constante, `production` | **Obrigatória e sem valor padrão.** A plataforma não a define. Além de habilitar a partida, é ela que liga os guardas de produção: exigir os identificadores de segredo, recusar os valores de contorno e recusar transporte não cifrado |
| `DATABASE_HOST` | output `db_host` do state remoto | Nunca digitado |
| `DATABASE_PORT` | output `db_port` do state remoto | Nunca digitado |
| `DATABASE_NAME` | output `db_name` do state remoto | Nunca digitado |
| `DATABASE_SECRET_ID` | output `db_credentials_secret_arn` do state remoto | **Opaco por contrato** — ver abaixo |
| `CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID` | recurso desta stack | Contêiner declarado aqui, valor escrito pela entrega |
| `NODE_EXTRA_CA_CERTS` | constante | Pacote de autoridades que a imagem do runtime já traz — ver [Banco de dados](database.md#transporte-cifrado) |
| `NODE_OPTIONS` | constante, `--enable-source-maps` | A construção emite o mapa; sem a opção, a pilha de uma falha interna aponta para posição no pacote em vez de arquivo de origem |
| `SERVICE_VERSION` | a entrega, `github.sha` | Alimenta o atributo `service.version` que o registro estruturado já emite |
| `DD_API_KEY`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION`, `DD_SERVERLESS_LOGS_ENABLED`, `DD_TRACE_ENABLED` | camada de coleta | Declaradas apenas com o interruptor ligado — ver [Observabilidade](observability.md) |

Nenhum valor sensível aparece no código versionado: a credencial do banco é
resolvida em execução, a chave de assinatura também, e a credencial de telemetria
vem do cofre do environment.

## O contrato de output da credencial do banco

Esta stack consome o **output**, nunca um nome fixo. Três propriedades — todas
verificáveis — tornam gratuita a troca de implementação a montante, de segredo
declarado explicitamente para credencial gerenciada pelo próprio serviço de
banco:

1. **O nome do output é o contrato**, e o identificador do segredo é opaco. A
   stack de banco pode trocar o valor de `db_credentials_secret_arn` de um
   segredo declarado para o identificador de um segredo gerenciado — cujo nome é
   gerado e não pode ser escolhido — sem que nada aqui mude.
2. **A forma do conteúdo é a mesma**: campos `username` e `password`, com campos
   adicionais tolerados pelo leitor. A credencial gerenciada acrescenta campos de
   motor, endereço, porta e nome do banco; o leitor os ignora.
3. **O modelo de cifração é o mesmo**: chave gerenciada padrão do serviço de
   segredos, de modo que a permissão de decifração seja idêntica nas duas
   implementações.

Endereço, porta e nome do banco continuam vindo dos outputs que a stack de banco
já expõe, e **não** do segredo — assim a origem desses três não muda junto.

No plano de execução, a promessa é fechada pelo descarte da composição memoizada
quando o banco recusa autenticação: a invocação seguinte relê o segredo, e um
ambiente já aquecido não fica inutilizável até ser reciclado.

## A chave privada não transita pelo state

O contêiner do segredo é declarado aqui; o **valor** é escrito pela entrega, de
forma idempotente, com identificador de requisição derivado do resumo
criptográfico do material.

Declarar o valor na infraestrutura o colocaria em texto puro no state, num bucket
compartilhado por cinco stacks. Quem tem a chave privada emite token para
qualquer cliente: é o material mais sensível da solução.

É uma divergência deliberada da postura da stack de banco quanto à senha do
banco, e o custo é que um ambiente novo só fica funcional depois de a entrega
executar — o que ela faz de qualquer forma.

## O artefato

O arquivo compactado é montado por `archive_file` sobre `app/dist`, no momento da
aplicação: uma única fonte de verdade para o conteúdo e para o identificador de
conteúdo. A fonte de dados normaliza carimbos de tempo, então o identificador
deriva do conteúdo e um commit inalterado não produz diferença na prévia.

`output_file_mode` é declarado explicitamente porque a normalização **não**
cobre permissões de arquivo, que entram no arquivo compactado e diferem entre
sistemas operacionais.

## Executar localmente

```bash
cd terraform
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

Os três não exigem credenciais: fontes de dados não são avaliadas nessas etapas.

Para uma prévia é preciso o laboratório ligado, credenciais válidas e o pacote
construído — a configuração declara uma fonte de dados sobre `app/dist`:

```bash
cd app && npm ci && npm run build && cd ../terraform
terraform init -reconfigure
terraform plan
```

Uma prévia executada em sistema operacional diferente do da esteira pode acusar
diferença no identificador de conteúdo do pacote sem mudança de código — ver
[CI/CD › Solução de problemas](ci-cd.md#solucao-de-problemas).

## Outputs

| Output | Para quê |
| --- | --- |
| `function_name` | Contrato com o API Gateway, que monta o endereço de invocação a partir dele |
| `function_arn` | Identificação do recurso |
| `function_invoke_arn` | Endereço de invocação |
| `function_version` | Versão imutável publicada pela aplicação |
| `jwt_private_key_secret_arn` | Consumido pela entrega, que grava o valor |
| `log_group_name` | Diagnóstico |
| `api_endpoint` | Repassado do state remoto do API Gateway para o portão final da entrega |

Nada nesta stack é consumido por outro repositório: ela pode ser removida por
completo sem afetar as demais, e o API Gateway continua montando o endereço por
convenção de nome.
