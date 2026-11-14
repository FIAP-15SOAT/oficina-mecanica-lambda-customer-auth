# Arquitetura

Uma função serverless que faz **uma** coisa: recebe CPF e senha, confere a
credencial e o vínculo nos serviços donos desses dados, e emite um token. A
arquitetura existe para que essa decisão fique testável sem infraestrutura e para
que trocar o transporte, o cliente HTTP ou a biblioteca de assinatura não alcance
a regra.

Dois serviços da solução participam de todo login:

- o **Identity**, serviço que guarda os usuários e as senhas, verifica a
  credencial;
- o **work-order**, serviço das ordens de serviço, que guarda os clientes e os
  vínculos entre usuário e cliente, devolve os clientes ativos do usuário.

## Camadas

As dependências de código-fonte apontam **somente para dentro**.

```
┌─────────────────────────────────────────────────────────────┐
│ infrastructure/                                             │
│   serverless/ config/ logging/ clients/ gateways/ security/ │
│                                         ← implementa portas │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ interface-adapters/  (controller, presenter, DTOs)    │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ application/  (caso de uso, portas, catálogo)   │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │ domain/  (Cpf, validação, exceções)       │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Camada | Responsabilidade | O que **não** pode |
| --- | --- | --- |
| `domain` | Regra pura: normalização e validação do CPF. | Conhecer HTTP, nuvem, log ou assinatura. |
| `application` | Orquestrar o caso de uso sobre portas declaradas por ela mesma, inclusive os gateways dos dois serviços; o catálogo de eventos de log. | Importar biblioteca de infraestrutura. |
| `interface-adapters` | Traduzir entre o caso de uso e as formas de requisição e resposta. Livre de framework. | Conhecer o formato de evento da plataforma. |
| `infrastructure` | Implementar as portas e ser o **único** lugar que conhece o ambiente serverless e a rede. | — |

### Um anel de adaptadores, não dois

Os serviços NestJS da solução mantêm dois anéis — um livre de framework e outro
que é a fronteira de adaptação do framework. O segundo existe **porque o
framework exige**. Aqui não há framework: um anel cumpre o papel, e a tradução do
formato de evento e de resposta fica confinada a `infrastructure/serverless/`.

### A separação das camadas é verificada pelo lint

`eslint.config.mjs` proíbe `domain/` e `application/` de importarem
`aws-lambda`, `axios`, `jose`, `pino`, `@aws-sdk/*` e módulos de
`@infrastructure`/`@interface-adapters`. Uma segunda regra permite `aws-lambda`
apenas em `src/infrastructure/serverless/` e em `src/handler.ts`, que é a fronteira de entrada
da plataforma por definição. Violação **falha** a verificação — não emite aviso.

Trocar a versão da carga de evento do API Gateway alcança o validador de evento e
o ponto de entrada, e nada mais: nem o caso de uso, nem o domínio, nem os testes
de nenhum dos dois.

## Portas

Todo recurso externo é uma interface, e o caso de uso também é exposto por uma.

| Porta | Onde vive | Implementação |
| --- | --- | --- |
| `IIdentityCustomerCredentialsGateway` | `application/ports/output/gateways/identity/` | `HttpIdentityCustomerCredentialsGateway` |
| `IWorkOrderUserCustomersGateway` | `application/ports/output/gateways/work-order/` | `HttpWorkOrderUserCustomersGateway` |
| `ITokenIssuerService` | `application/ports/output/` | `JoseTokenIssuerService` |
| `ILogger` | `application/ports/output/` | `PinoLoggerAdapter` |
| `IAuthenticateCustomerUseCase` | `application/ports/input/auth/` | `AuthenticateCustomerUseCase` |

Um gateway é a porta de saída para outro serviço: a interface fica na aplicação,
com os tipos que ela devolve ao lado (sufixo `GatewayResponse`), e o adaptador
fica em `infrastructure/gateways/<serviço>/`. Na suíte unitária o caso de uso é
instanciado com implementações de teste das quatro portas: sem rede, sem nuvem.

## Gateways e o cliente HTTP interno

Os dois adaptadores usam o mesmo `InternalHttpClient`
(`infrastructure/clients/internal-http-client.ts`), feito sobre o `axios`:

| Configuração | Valor | Por quê |
| --- | --- | --- |
| Tempo limite | 2 s por chamada | Duas chamadas e a assinatura ficam bem abaixo do teto de 30 s do API Gateway |
| Redirect | não seguido | Uma rota interna não redireciona; um redirect indica destino errado |
| Conexão | nova a cada chamada, com `Connection: close` | O ambiente da função congela entre invocações e os serviços fecham a conexão ociosa depois de 5 s: uma conexão reaproveitada pode já estar fechada e falhar o primeiro login depois de um tempo parado |
| Cabeçalhos | `x-request-id` e `traceparent` | Correlação com os logs e os traces dos dois serviços — ver [Correlação](#correlação) |

O cliente é criado **por invocação**, porque carrega o identificador e o
contexto de trace daquela invocação. Toda falha da chamada — tempo esgotado,
conexão recusada, redirect, 4xx ou 5xx — vira `ServiceIntegrationException`, com
a mensagem `Falha na chamada interna <método> <rota>` (mais `com status <n>`
quando houve resposta), que o tradutor de respostas converte em `503`.

O gateway do Identity trata o `401` como **credencial recusada** e devolve
`null`, com qualquer corpo; outro 4xx dele significa que os dois contratos
divergiram e continua sendo indisponibilidade. O gateway do work-order devolve a
lista de clientes ativos vinculados ao usuário; lista vazia é recusa, decidida
pelo caso de uso. As formas de cada resposta estão em
[Contrato › Chamadas internas](contracts.md#chamadas-internas).

## Composição memoizada

`app/src/bootstrap.ts` é o ponto único de fiação, e é memoizado.

**Isto não é injeção de dependência.** Nenhum contêiner reflexivo é adotado: são
poucas linhas para poucos objetos. É uma exigência do ambiente, que congela
entre invocações e reaproveita o mesmo processo. Há duas inicializações caras —
a leitura do segredo da chave privada e a importação dessa chave — que precisam
ocorrer **uma vez por ambiente**.

```
warmUp()  ────────── na fase de Init, só na plataforma: dispara o que vem
                     abaixo sem esperar a primeira invocação

getDependencies()  ─┬─ já resolvido? devolve a mesma promessa
                    │
                    └─ primeira vez:
                       loadEnvironment()     → falha aqui → 500 documentado
                       segredo da chave privada
                       JoseTokenIssuerService.create()  → PEM inválido falha aqui
                       createController(logger, contexto da chamada)
                         pronto para cada invocação: cria o cliente HTTP
                         interno e os dois gateways daquela invocação
```

**O aquecimento é início, não barreira.** O módulo do ponto de entrada é
carregado na fase de Init, que recebe CPU cheia e, sob concorrência provisionada,
acontece antes de qualquer tráfego. Começar ali antecipa a leitura do segredo e
a importação do PEM, mas a invocação ainda aguarda a promessa se a composição
não tiver terminado. O que ele deliberadamente **não** faz é abortar o ambiente:
uma configuração inválida precisa chegar ao cliente no envelope de erro
documentado, e uma falha de Init entregaria um erro de plataforma, que não está
no contrato. Fora da plataforma o aquecimento é inerte, para que importar o
módulo em teste ou script não dispare efeito nenhum.

As chamadas ao Identity e ao work-order ficam **fora** da composição: pertencem à
invocação, e um serviço indisponível responde aquela invocação com `503` em vez
de derrubar a composição com um `500` de inicialização.

Uma falha de inicialização **não** é memoizada: uma indisponibilidade transitória
do gerenciador de segredos não pode condenar o ambiente a devolver a mesma
promessa rejeitada para sempre. Ela também não escapa sem registro — a linha de
atendimento sai com correlação e atributos de execução como em qualquer outra
invocação, porque um `500` de inicialização é justamente o que mais precisa ser
encontrado numa consulta.

As alternativas seriam espalhar caches independentes por vários módulos —
multiplicando o que o teste precisa reiniciar — ou colocar a fiação no ponto de
entrada, engordando justamente o que se quer fino.

## Fluxo de uma invocação

```
evento do API Gateway
  │
  ├─ resolveCorrelationId(headers, invocationId)   → request.id
  ├─ createTraceContext()                          → trace_id e traceparent
  ├─ logger.forInvocation({ faas.*, cloud.*, request.id, trace_id })
  │     (antes da composição: falhar em compor também é um atendimento)
  ├─ getDependencies()   (memoizado; aquecido no Init) ── falha → 500 documentado
  │
  ├─ validateLoginEvent(evento)  ── recusa → evento de entrada inválida → 400
  │      │ ok
  │      ▼
  │  controller.login({ cpf, password })
  │      │
  │      ▼
  │  caso de uso
  │      ├─ Cpf.create()                              ── inválido → evento → 400
  │      ├─ Identity: POST /internal/customer-authentications
  │      │      401 → recusa credential_refused → 401
  │      │      falha → internal.call.failed → 503
  │      ├─ work-order: GET /internal/users/:userId/customers
  │      │      lista vazia → recusa no_active_customer_link → 401
  │      │      falha → internal.call.failed → 503
  │      └─ emissor.issueAccessToken()                ── falha → evento → 500
  │      ▼
  │  presenter → { data: { accessToken, expiresIn } }
  │
  └─ linha do atendimento (nível derivado do status, duração total) → resposta
```

**No máximo duas linhas por invocação:** a do atendimento, sempre, e no máximo
um evento adicional. Quem conhece a causa é quem a registra — o caso de uso
registra o que julga, o handler registra o que recusa antes de o caso de uso
existir, e o ponto de entrada registra as falhas de mecanismo (chamada interna e
assinatura). Não há caminho em que dois eventos sejam emitidos.

O Identity responde o mesmo `401` para CPF inexistente, conta inativa e senha
incorreta e registra a causa no próprio log; esta função distingue só as duas
etapas da recusa — credencial recusada e nenhum cliente ativo.

## Correlação

Toda linha de log de uma invocação leva duas chaves, e as duas viajam nas
chamadas internas:

| Chave no log | Cabeçalho enviado | Origem |
| --- | --- | --- |
| `request.id` | `x-request-id` | O cabeçalho `x-request-id` ou `x-correlation-id` recebido do API Gateway, quando válido; senão, o identificador da invocação |
| `trace_id` | `traceparent` | Gerado pela função a cada invocação: `00-<trace id>-<span id>-01`, com 32 e 16 caracteres hexadecimais aleatórios |

O `traceparent` é o cabeçalho do padrão W3C Trace Context, que os serviços usam
para propagar o trace. O Identity e o work-order continuam o trace recebido, então
o login aparece nos traces dos dois com o mesmo `trace_id` do log desta função. A
função não tem SDK de trace e não emite span próprio — ver
[ADR 0008](adr/0008-contexto-de-trace-sem-sdk.md) e
[Observabilidade](observability.md).

## Ponto de entrada fino

`app/src/handler.ts` obtém as dependências já inicializadas, delega e responde.
Sem regra de negócio, sem montagem de dependências, sem chamada a outro serviço,
sem construção de token. Ele **não** é excluído da cobertura: contém ramificação
e falha de formas visíveis ao cliente.

## Árvore de diretórios

```
.
├── app/                     código e TODA a configuração da função
│   ├── src/
│   │   ├── domain/
│   │   │   ├── exceptions/
│   │   │   ├── validators/        cpf.validator.ts
│   │   │   └── value-objects/     cpf.vo.ts
│   │   ├── application/
│   │   │   ├── exceptions/
│   │   │   ├── logging/           log-event, log-field, business-event.catalog
│   │   │   ├── ports/input/       o caso de uso
│   │   │   ├── ports/output/      logger, emissor e gateways/{identity,work-order}
│   │   │   └── use-cases/auth/    authenticate-customer.use-case.ts
│   │   ├── interface-adapters/auth/
│   │   ├── infrastructure/
│   │   │   ├── clients/           internal-http-client.ts
│   │   │   ├── config/            environment, secret-resolver, aws-secrets.gateway
│   │   │   ├── exceptions/
│   │   │   ├── gateways/          identity/, work-order/
│   │   │   ├── logging/           registro, redação, adapter, correlação, trace, execução
│   │   │   ├── security/          jose
│   │   │   └── serverless/        validador de evento, tradutor de resposta
│   │   ├── bootstrap.ts           composição memoizada
│   │   └── handler.ts             ponto de entrada
│   ├── test/
│   │   ├── unit/                  espelha src/
│   │   ├── e2e/                   ponto de entrada contra o stub dos dois serviços
│   │   ├── contracts/             fixtures publicadas pelo Identity e pelo work-order
│   │   └── helpers/               fábricas de mocks, stub HTTP e leitores de fixture
│   ├── scripts/                   build, invoke, stub-services
│   ├── events/                    evento versionado para invocação avulsa
│   └── package.json  tsconfig.json  jest*.config.ts  eslint.config.mjs  sonar-project.properties
├── docs/                    esta documentação e os ADRs
├── infra/                   a stack da função: rede, log, segredo, autorização
└── .github/                 workflows de validação, análise estática e entrega
```

A raiz **não** contém manifesto de dependência nem configuração de compilação,
teste ou análise estática. Essa organização espelha a dos serviços, para que
quem transita entre os repositórios encontre as mesmas coisas nos mesmos
lugares.

## Aliases resolvidos em tempo de build

`@domain`, `@application`, `@interface-adapters` e `@infrastructure` são
declarados uma vez, no `paths` do `tsconfig.json`. O `esbuild` os resolve
durante a compilação: o artefato publicado **não contém nem depende** de
resolvedor de aliases em tempo de execução. Quem afirma isso é o próprio
`app/scripts/build.ts`, que inspeciona o pacote gerado e **falha o build** se
algum alias sobreviver — um alias não resolvido só quebraria na primeira
invocação publicada.

O Jest resolve módulos antes de o TypeScript participar, então precisa do mapa
equivalente. Ele é declarado uma vez em `jest.config.ts` e **importado** por
`jest.e2e.config.ts`, em vez de copiado.

## A forma implantada

O desenho acima descreve o código. Esta seção descreve onde ele executa.

![Diagrama de arquitetura: o cliente chama por HTTPS o API Gateway, que publica
POST /customer-auth/login e invoca a função Lambda; a função executa nas duas
subnets privadas da VPC 10.0.0.0/16, com security group próprio e interface de
rede criada na partida a frio, alcança o Amazon RDS PostgreSQL 16 na porta 5432
e o Secrets Manager pelo NAT Gateway, e emite log para o CloudWatch Logs com
retenção de 14 dias](diagrams/infrastructure.png)

**Rede.** A função é anexada às subnets privadas da rede da solução, com grupo de
segurança próprio, porque o NLB que dá acesso ao Identity e ao work-order é
interno: só aceita tráfego de dentro da VPC. O NLB (Network Load Balancer) é o
balanceador de rede do cluster Kubernetes, com uma porta por serviço — `8081`
para o Identity e `80` para o work-order. O grupo da função não declara
ingresso — nada conecta na função, que é invocada por chamada de serviço — e
libera o egresso.

**URLs internas.** `IDENTITY_INTERNAL_URL` e `WORK_ORDER_INTERNAL_URL` são
montadas pela stack a partir do endereço e das portas que o repositório do
cluster publica — ver [Infraestrutura](terraform.md#variáveis-de-ambiente-da-função).
Nenhum endereço é digitado.

**Interface anexada.** A Lambda usa ENIs Hyperplane (as interfaces de rede que a
plataforma cria para ligar a função à VPC) associadas à combinação de
subnets e security groups, que podem ser compartilhadas por ambientes e funções.
A criação inicial e a preparação da rede podem atrasar a disponibilidade da
função; não há uma ENI nova obrigatoriamente criada a cada partida a frio nem
medição local que atribua a elas o maior custo. Ver [AWS › Acesso a VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html).

**Partida a frio e antecipação da composição.** O ponto de entrada dispara a
composição durante a **inicialização do ambiente**, não na primeira invocação:
isso antecipa a leitura do segredo e a importação do PEM, sem controlar a criação
das ENIs nem garantir que a composição termine antes da invocação. Sem isso, a
primeira credencial real pagaria a leitura do segredo e a importação do PEM.

**Concorrência.** A concorrência reservada limita quantos ambientes existem ao
mesmo tempo. Cada login custa ao Identity uma verificação de hash de senha, que consome
CPU, e o Identity roda com uma ou duas réplicas: a reserva limita essa carga.

**Publicação de versão ligada**, sem alias: o API Gateway constrói o endereço
de invocação sem qualificador e executa `$LATEST`, não a versão numerada
registrada no output. Detalhes em
[ADR 0004](adr/0004-empacotamento-e-publicacao.md) e
[Infraestrutura](terraform.md).

## Divergências deliberadas em relação aos serviços

| Decisão dos serviços NestJS | Aqui | Por quê |
| --- | --- | --- |
| Dois anéis de adaptadores | Um | O segundo anel existe por causa do framework, que aqui não existe |
| `@nestjs/axios` para chamadas internas | `axios` direto | O mesmo cliente, sem o módulo do framework |
| SDK OpenTelemetry com spans próprios | `traceparent` gerado pela função, sem SDK | Um span só não paga o custo de partida a frio — ver [ADR 0008](adr/0008-contexto-de-trace-sem-sdk.md) |
| Módulo de JWT do framework | `jose` direto | Zero dependências transitivas e falha de chave na inicialização |
| Módulos e provedores do framework | Composição memoizada em um arquivo | Ver [ADR 0002](adr/0002-camadas-enxutas-com-composicao-memoizada.md) |
| Envelope e dicionário de log | **Idênticos** | É o que faz uma consulta cobrir os serviços e a função — as diferenças de conteúdo estão em [Logging](logging.md) |

Esta função não guarda nem replica usuário, senha, cliente ou vínculo: a
credencial é do Identity e o vínculo é do work-order, e a decisão está no
[ADR 0007](adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md).
