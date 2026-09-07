# Arquitetura

Uma função serverless que faz **uma** coisa: recebe CPF e senha, decide, e emite
um token. A arquitetura existe para que essa decisão fique testável sem
infraestrutura e para que trocar o transporte, o banco ou a biblioteca de
assinatura não alcance a regra.

## Camadas

As dependências de código-fonte apontam **somente para dentro**.

```
┌─────────────────────────────────────────────────────────────┐
│ infrastructure/                                             │
│   serverless/ config/ logging/ persistence/ security/       │
│   observability/                        ← implementa portas │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ interface-adapters/  (controller, presenter, DTOs)    │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ application/  (caso de uso, portas, catálogo)   │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │ domain/  (Cpf, CustomerUser, contrato do   │  │  │  │
│  │  │  │           repositório, exceções)          │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Camada | Responsabilidade | O que **não** pode |
| --- | --- | --- |
| `domain` | Regra pura: validação de CPF, a condição que habilita o acesso externo, o contrato do repositório. | Conhecer banco, HTTP, nuvem, log ou assinatura. |
| `application` | Orquestrar o caso de uso sobre portas declaradas por ela mesma; o catálogo de eventos de log. | Importar biblioteca de infraestrutura. |
| `interface-adapters` | Traduzir entre o caso de uso e as formas de requisição e resposta. Livre de framework. | Conhecer o formato de evento da plataforma. |
| `infrastructure` | Implementar as portas e ser o **único** lugar que conhece o ambiente serverless. | — |

### Um anel de adaptadores, não dois

A API principal mantém dois anéis — um livre de framework e outro que é a borda
do framework. O segundo existe **porque o framework exige**. Aqui não há
framework: um anel cumpre o papel, e a tradução do formato de evento e de
resposta fica confinada a `infrastructure/serverless/`.

### A cerca é executável

`eslint.config.mjs` proíbe `domain/` e `application/` de importarem
`aws-lambda`, `pg`, `jose`, `bcryptjs`, `pino`, `@aws-sdk/*` e módulos de
`@infrastructure`/`@interface-adapters`. Uma segunda regra permite `aws-lambda`
apenas em `src/infrastructure/serverless/` e em `src/handler.ts`, que é a borda
da plataforma por definição. Violação **falha** a verificação — não emite aviso.

Trocar a versão da carga de evento do gateway alcança o validador de evento e o
ponto de entrada, e nada mais: nem o caso de uso, nem o domínio, nem os testes
de nenhum dos dois.

## Portas

Todo recurso externo é uma interface, e o caso de uso também é exposto por uma.

| Porta | Onde vive | Implementação |
| --- | --- | --- |
| `ICustomerIdentityRepository` | `domain/interfaces/repositories/` | `PgCustomerIdentityRepository` |
| `IHashService` | `application/ports/output/` | `BcryptHashService` |
| `ITokenIssuerService` | `application/ports/output/` | `JoseTokenIssuerService` |
| `ILogger` | `application/ports/output/` | `PinoLoggerAdapter` |
| `IAuthenticateCustomerUseCase` | `application/ports/input/auth/` | `AuthenticateCustomerUseCase` |

O contrato do repositório vive no **domínio**, porque quem o define é a regra,
não a aplicação. Na suíte unitária o caso de uso é instanciado com
implementações de teste das quatro portas: sem banco, sem rede, sem nuvem.

## Composição memoizada

`app/src/bootstrap.ts` é o ponto único de fiação, e é memoizado.

**Isto não é injeção de dependência.** Nenhum contêiner reflexivo é adotado: são
poucas linhas para quatro objetos. É uma exigência do ambiente, que congela
entre invocações e reaproveita o mesmo processo. Há três inicializações caras —
os dois segredos, a conexão que depende de um deles e a chave preparada a partir
do outro — que precisam ocorrer **uma vez por ambiente**.

```
warmUp()  ────────── na fase de Init, só na plataforma: dispara o que vem
                     abaixo sem esperar a primeira invocação

getDependencies()  ─┬─ já resolvido? devolve a mesma promessa
                    │
                    └─ primeira vez:
                       loadEnvironment()     → falha aqui → 500 documentado
                       Promise.all([ segredo do banco, chave privada ])
                       createPool()          → pool de tamanho 1
                       JoseTokenIssuerService.create()  → PEM inválido falha aqui
                       createController(logger) pronto para cada invocação
```

**O aquecimento é início, não barreira.** O módulo do ponto de entrada é
carregado na fase de Init, que recebe CPU cheia e, sob concorrência provisionada,
acontece antes de qualquer tráfego — começar ali faz a primeira credencial real
não pagar segredos, PEM e handshake. O que ele deliberadamente **não** faz é
abortar o ambiente: uma configuração inválida precisa chegar ao cliente no
envelope de erro documentado, e uma falha de Init entregaria um erro de
plataforma, que não está no contrato. Fora da plataforma o aquecimento é inerte,
para que importar o módulo em teste ou script não dispare efeito nenhum.

Os dois segredos são obtidos **em paralelo**: são independentes, e serializá-los
custaria uma ida de rede inteira no caminho frio.

Uma falha de inicialização **não** é memoizada: uma indisponibilidade transitória
do gerenciador de segredos não pode condenar o ambiente a devolver a mesma
promessa rejeitada para sempre. Ela também não escapa sem registro — a linha de
atendimento sai com correlação e atributos de execução como em qualquer outra
invocação, porque um `500` de inicialização é justamente o que mais precisa ser
encontrado numa consulta.

As alternativas seriam espalhar três caches independentes por três módulos —
triplicando o que o teste precisa reiniciar — ou colocar a fiação no ponto de
entrada, engordando justamente o que se quer fino.

## Fluxo de uma invocação

```
evento do gateway
  │
  ├─ resolveCorrelationId(headers, invocationId)
  ├─ logger.forInvocation({ faas.*, cloud.*, request.id })
  │     (antes da composição: falhar em compor também é um atendimento)
  ├─ getDependencies()   (memoizado; aquecido no Init) ── falha → 500 documentado
  ├─ timings.reset()
  │
  ├─ translateRequest(evento)  ── recusa → evento de entrada inválida → 400
  │      │ ok
  │      ▼
  │  controller.login({ cpf, password })
  │      │
  │      ▼
  │  caso de uso
  │      ├─ Cpf.create()                    ── inválido → evento → 400
  │      ├─ repositório.findByCpf()          (uma consulta; duração medida)
  │      ├─ verificador.compare()            (duração medida)
  │      ├─ julga as quatro condições        ── recusa → evento → 401
  │      └─ emissor.issueAccessToken()               ── falha → evento → 500
  │      ▼
  │  presenter → { data: { accessToken, expiresIn } }
  │
  └─ linha do atendimento (nível derivado do status, três durações) → resposta
```

**No máximo duas linhas por invocação:** a do atendimento, sempre, e no máximo
um evento adicional. Quem conhece a causa é quem a registra — o caso de uso
registra o que julga, a borda registra o que recusa antes de o caso de uso
existir, e o ponto de entrada registra as duas falhas de mecanismo. Não há
caminho em que dois eventos sejam emitidos.

## Ponto de entrada fino

`app/src/handler.ts` obtém as dependências já inicializadas, delega e responde.
Sem regra de negócio, sem montagem de dependências, sem acesso a banco, sem
construção de token. Ele **não** é excluído da cobertura: contém ramificação e
falha de formas visíveis ao cliente.

## Árvore de diretórios

```
.
├── app/                     código e TODA a configuração da função
│   ├── src/
│   │   ├── domain/
│   │   │   ├── entities/          customer-user.entity.ts
│   │   │   ├── exceptions/
│   │   │   ├── interfaces/repositories/
│   │   │   ├── validators/        cpf.validator.ts
│   │   │   └── value-objects/     cpf.vo.ts
│   │   ├── application/
│   │   │   ├── exceptions/
│   │   │   ├── logging/           log-event, log-field, business-event.catalog
│   │   │   ├── ports/input|output/
│   │   │   └── use-cases/auth/    authenticate-customer.use-case.ts
│   │   ├── interface-adapters/auth/
│   │   ├── infrastructure/
│   │   │   ├── config/            environment, secret-resolver, aws-secrets.gateway
│   │   │   ├── exceptions/
│   │   │   ├── logging/           registro, redação, adapter, correlação, execução
│   │   │   ├── observability/     invocation-timings.ts
│   │   │   ├── persistence/pg/    connection, repository, mapper
│   │   │   ├── security/          bcrypt, jose
│   │   │   └── serverless/        validador de evento, tradutor de resposta
│   │   ├── bootstrap.ts           composição memoizada
│   │   └── handler.ts             ponto de entrada
│   ├── test/{unit,e2e,helpers}/
│   ├── scripts/                   build, invoke
│   ├── events/                    evento versionado para invocação avulsa
│   └── package.json  tsconfig.json  jest*.config.ts  eslint.config.mjs  sonar-project.properties
├── docs/                    esta documentação e os ADRs
└── infra/                   reservado — será preenchido por change própria
```

A raiz **não** contém manifesto de dependência nem configuração de compilação,
teste ou análise estática. Essa organização espelha a da API principal, para que
quem transita entre os dois repositórios encontre as mesmas coisas nos mesmos
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

## Divergências deliberadas em relação à API

| Decisão da API | Aqui | Por quê |
| --- | --- | --- |
| Dois anéis de adaptadores | Um | O segundo anel existe por causa do framework, que aqui não existe |
| ORM sobre o schema | Driver e uma consulta escrita à mão | Uma consulta de leitura — ver [ADR 0001](adr/0001-driver-em-vez-de-orm.md) |
| bcrypt nativo | bcrypt em JavaScript puro | Módulo nativo não executa na plataforma sem camada — ver [ADR 0003](adr/0003-bcrypt-em-javascript-puro.md) |
| Módulo de JWT do framework | `jose` direto | Zero dependências transitivas e falha de chave na inicialização |
| Módulos e provedores do framework | Composição memoizada em um arquivo | Ver [ADR 0002](adr/0002-camadas-enxutas-com-composicao-memoizada.md) |
| Envelope e dicionário de log | **Idênticos** | É o que faz uma consulta cobrir os dois serviços — as diferenças de conteúdo estão em [Logging](logging.md) |

O modelo de identidade que esta função lê — `users.cpf`, `user_customers` e
`customers.is_active` — é definido e mantido pela API principal. O racional está
no ADR de autenticação de clientes daquele repositório
(`docs/adr/0004-autenticacao-de-clientes.md`, em `oficina-mecanica-app`).
Este repositório **lê** esse modelo e não o define.
