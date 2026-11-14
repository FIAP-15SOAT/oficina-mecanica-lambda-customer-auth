<div align="center">

# 🔐 Oficina Mecânica · Customer Auth

**Autenticação de clientes por CPF e senha, em função serverless.** Recebe uma
credencial, confere-a nos serviços donos dos dados e emite o token que o
work-order já sabe verificar.

![Node](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![AWS Lambda](https://img.shields.io/badge/AWS%20Lambda-FF9900?logo=awslambda&logoColor=white)
![Cobertura](https://img.shields.io/badge/cobertura-100%25-brightgreen)

[![CI](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/ci.yml)
[![SAST](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/sast.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/sast.yml)
[![CD](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/cd.yml/badge.svg)](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/actions/workflows/cd.yml)

</div>

## 📋 Sobre

Projeto acadêmico da pós-graduação em Arquitetura de Software da FIAP (turma
15SOAT), parte do ecossistema da **Oficina Mecânica**.

A oficina precisa que o **cliente final** — e não apenas o funcionário — se
autentique para consultar as próprias ordens de serviço e aprovar ou rejeitar
orçamentos. Dois serviços da solução guardam o que a decisão precisa: o
**Identity**, serviço que guarda os usuários e as senhas, e o **work-order**,
serviço das ordens de serviço, que guarda os clientes e os vínculos entre usuário
e cliente. O work-order também verifica o token do cliente nas rotas
`/api/me/**`. A emissão desse token pertence a esta função serverless, separada
do login interno dos funcionários: o cliente usa o JWT RS256 recebido aqui.

## 🎯 Responsabilidade

**O que a função faz**

- Expõe `POST /customer-auth/login`, recebendo `{ cpf, password }`.
- Normaliza e valida o CPF e pede ao Identity a verificação da credencial
  (`POST /internal/customer-authentications`). O Identity confere se o usuário
  existe, se a conta está ativa e se a senha confere.
- Com a credencial aceita, pede ao work-order os clientes ativos vinculados ao
  usuário (`GET /internal/users/:userId/customers`) e exige **ao menos um**.
- Emite um JWT **RS256** com exatamente `sub`, `iss`, `aud`, `iat` e `exp`, mais
  `kid` no cabeçalho. Validade configurável, padrão 3600 s. Sem refresh token.

As duas chamadas são internas: passam pelo NLB (Network Load Balancer, o
balanceador de rede interno do cluster Kubernetes onde os serviços rodam) e
levam o identificador da requisição e o contexto de trace da invocação.

**O que ela não faz**

Não cria usuário, não define ou altera senha, não administra vínculos, não
acessa banco de dados e não guarda estado entre invocações. Se o Identity ou o
work-order estiverem fora do ar, o login responde `503`.

**Uma propriedade que a define**

- **Mensagem única** para toda falha de credencial: CPF inexistente, conta
  inativa, senha incorreta e ausência de vínculo produzem resposta idêntica.
- **Sem escrita**: a função faz duas leituras nos serviços donos e assina um
  token.

## 🧰 Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Runtime | Node.js 24 · TypeScript | Mesma stack dos serviços |
| Chamadas internas | `axios` | O mesmo cliente HTTP que os serviços usam; timeout de 2 s e conexão nova a cada chamada — [ADR 0007](docs/adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md) |
| Assinatura | `jose` | Zero dependências transitivas; chave importada na inicialização |
| Log | `pino`, stdout síncrono | Envelope e dicionário compatíveis com os dos serviços |
| Configuração | `zod` | Falha na inicialização, não por requisição |
| Build | `esbuild` → pacote único CJS | Sem código nativo; o `.zip` é montado pelo Terraform |
| Testes | Jest | Unitário e ponta a ponta contra stubs dos serviços — [Testes](docs/testing.md) |

Nenhuma dependência de runtime é módulo nativo, o que mantém o artefato
portátil.

## ⚙️ Pré-requisitos

- **Node.js 24+**

Nenhuma credencial de nuvem, banco ou serviço no ar é necessário para
desenvolver: um stub local responde pelo Identity e pelo work-order. Um stub é
um servidor HTTP de teste que imita as rotas internas dos dois serviços com
respostas fixas.

## 🚀 Início rápido

```bash
cd app
npm ci
cp .env.example .env

# chave privada de teste — gere a sua; nenhuma é versionada
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out key.pem
node -e "console.log('CUSTOMER_JWT_PRIVATE_KEY=' + JSON.stringify(require('node:fs').readFileSync('key.pem','utf8').replace(/\r/g,'')))" >> .env

npm run stub          # em outro terminal: stub do Identity e do work-order na porta 4010
npm run invoke        # executa o ponto de entrada com events/login.event.json
```

Não há servidor HTTP local da função: ela é exercitada pela invocação avulsa,
com um evento no formato que o API Gateway entrega. Trocar `cpf` e `password` em
`app/events/login.event.json` é o caminho mais curto para outro cenário.

Passo a passo completo, inclusive como usar o Identity e o work-order locais no
lugar do stub, em [Como executar localmente](docs/local-setup.md).

## 📜 Comandos

Todos rodam a partir de `app/`.

| Comando | O que faz |
| --- | --- |
| `npm run invoke` | Invoca o ponto de entrada **uma** vez, a partir de `events/login.event.json` |
| `npm run stub` | Sobe na porta 4010 o stub das rotas internas do Identity e do work-order, com o cliente do evento de exemplo |
| `npm run build` | Pacote único em CommonJS, com mapa de origem, em `dist/` |
| `npm test` | Suíte unitária — sem entrada e saída, sem contêiner, sem rede |
| `npm run test:cov` | Unitária com cobertura; exige 100% em linhas, instruções, funções e ramos |
| `npm run test:e2e` | Ponta a ponta: o ponto de entrada real contra o stub dos dois serviços |
| `npm run lint` | ESLint + Prettier, incluindo a regra que separa as camadas |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Aplica a formatação |

## 📁 Estrutura do Repositório

```text
.
├── .github/
│   ├── actions/setup-ci/       # Composite: Node 24, cache npm e npm ci
│   └── workflows/              # CI, SAST e CD da função
├── app/
│   ├── src/
│   │   ├── domain/              # Value Object do CPF, validação e exceções
│   │   ├── application/         # Caso de uso, portas e catálogo de eventos
│   │   ├── interface-adapters/  # Controller e apresentação do login
│   │   ├── infrastructure/     # Cliente HTTP interno, gateways, JWT, logging e evento
│   │   ├── bootstrap.ts        # Composição memoizada
│   │   └── handler.ts          # Ponto de entrada da plataforma
│   ├── test/                    # Unitários, E2E, stub e fixtures dos serviços
│   ├── events/                  # Eventos para execução local
│   ├── scripts/                 # Build, invocação avulsa e stub local
│   ├── .env.example            # Referência de configuração local
│   └── package.json            # Dependências e comandos npm
├── docs/
│   ├── adr/                    # Decisões arquiteturais
│   ├── diagrams/               # PNGs renderizados na documentação
│   ├── architecture.md         # Arquitetura e fluxo de autenticação
│   ├── ci-cd.md                # Workflows, jobs, steps e configuração GitHub
│   ├── terraform.md            # Recursos, inputs, outputs e aplicação local
│   ├── contracts.md            # Login, respostas, claims e chamadas internas
│   ├── security.md             # Ameaças e custódia da chave
│   ├── logging.md              # Envelope, campos e eventos
│   ├── observability.md        # Coleta opcional e correlação
│   ├── local-setup.md          # Desenvolvimento com o stub ou com os serviços locais
│   └── testing.md              # Unitários, E2E e cobertura
├── infra/                      # Função AWS Lambda e integrações
├── .gitignore
└── README.md
```

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| 📄 [Contrato](docs/contracts.md) | **Normativo e autocontido**: rota, corpo, envelope de sucesso, tabela de erros, claims, algoritmo, validade, identificador de chave e as duas chamadas internas |
| 🏛️ [Arquitetura](docs/architecture.md) | Camadas, portas, gateways, composição memoizada, fluxo de invocação com as duas chamadas, correlação e as divergências em relação ao work-order |
| 🔒 [Segurança](docs/security.md) | Modelo de ameaças, anti-enumeração, temporização, custódia da chave, e o que a limitação do gateway **não** protege |
| 📊 [Logging](docs/logging.md) | Envelope, dicionário completo, eventos, níveis e a tabela de divergências |
| 💻 [Como executar localmente](docs/local-setup.md) | A invocação avulsa, o stub local e os serviços locais |
| 🧪 [Testes](docs/testing.md) | Os dois níveis, o stub e as fixtures, propriedades travadas por teste e cobertura |
| 🔁 [CI/CD](docs/ci-cd.md) | Os três workflows, cada job e o que o reprova, os três portões pós-implantação, o inventário de configuração externa e o guia de solução de problemas |
| ☁️ [Infraestrutura](docs/terraform.md) | O que a stack provisiona, a fronteira entre repositórios, o consumo de state remoto e as variáveis da função |
| 🔭 [Observabilidade](docs/observability.md) | Os sinais que a função produz, a camada que os coleta, os eixos de correlação e o que não é instrumentado |
| 📐 [ADR 0001](docs/adr/0001-driver-em-vez-de-orm.md) | Driver em vez de ORM (substituído pelo ADR 0007) |
| 📐 [ADR 0002](docs/adr/0002-camadas-enxutas-com-composicao-memoizada.md) | Camadas enxutas com composição memoizada |
| 📐 [ADR 0003](docs/adr/0003-bcrypt-em-javascript-puro.md) | bcrypt em JavaScript puro, artefato compactado e execução local (emendado pelo ADR 0007) |
| 📐 [ADR 0004](docs/adr/0004-empacotamento-e-publicacao.md) | Empacotamento e publicação da função |
| 📐 [ADR 0005](docs/adr/0005-coleta-de-telemetria-sem-instrumentacao.md) | Coleta de telemetria sem instrumentação no código (emendado pelo ADR 0008) |
| 📐 [ADR 0006](docs/adr/0006-sem-analise-dinamica.md) | Sem análise dinâmica de segurança neste repositório |
| 📐 [ADR 0007](docs/adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md) | Credencial e vínculo verificados nos serviços donos |
| 📐 [ADR 0008](docs/adr/0008-contexto-de-trace-sem-sdk.md) | Contexto de trace sem SDK |

## 🧩 Ecossistema

| Repositório | Papel | Relação com esta função |
| --- | --- | --- |
| [`oficina-mecanica-identity-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service) | Serviço Identity (NestJS) | **Dono dos usuários e das senhas.** Verifica a credencial em `POST /internal/customer-authentications` e publica a fixture dessa rota |
| [`oficina-mecanica-work-order-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service) | Serviço work-order (NestJS) | **Dono dos clientes e dos vínculos.** Devolve os clientes ativos do usuário em `GET /internal/users/:userId/customers` e verifica, nas rotas `/api/me/**`, o token emitido aqui |
| [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) | Rede | Dona da VPC e das subnets privadas às quais esta função é anexada |
| [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) | Cluster | Dono do NLB interno; publica o endereço e as portas dele, que esta stack lê para montar as URLs internas |
| [`oficina-mecanica-api-gateway`](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway) | API Gateway | Publica `POST /customer-auth/login` e consome [`docs/contracts.md`](docs/contracts.md). Esta stack concede a autorização de invocação |
| [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring) | Observabilidade | Provisiona dashboards, monitors e Synthetic; a coleta opcional desta função é configurada nesta stack |
| **[`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth)** | **Esta função** | Emite o token externo, e é dona da própria stack de infraestrutura |

Esta função não guarda nem replica usuário, senha, cliente ou vínculo: guarda
só o `userId` recebido do Identity durante a invocação e busca o resto em quem é
dono do dado.

## 📦 Estado

- A função é implementada em camadas enxutas, coberta por suíte unitária com
  **100% em linhas, instruções, funções e ramos** e por suíte de ponta a ponta
  contra stubs que respondem com as fixtures publicadas pelo Identity e pelo
  work-order.
- A esteira valida toda mudança em seis verificações paralelas (Lint, Type
  Check, Unit Tests, E2E Tests, Package e Terraform Validation), a análise
  estática impõe o seu portão de qualidade, e a entrega provisiona a função e a
  publica — terminando em **três portões**: a invocação direta e a rota pública,
  ambas exigindo recusa de uma credencial inexistente, e o login de um cliente
  semeado, cujo token o work-order precisa aceitar.
- A infraestrutura vive em [`infra/`](infra/): a função em subnets
  privadas, o seu grupo de segurança, o grupo de log, o segredo da chave de
  assinatura, a concorrência reservada e a autorização de invocação concedida à
  API Gateway.
- `POST /customer-auth/login` é atendida pela função, e o token emitido aqui é
  aceito pelo work-order nas rotas `/api/me/**`. Passo a passo em
  [Como executar localmente](docs/local-setup.md#com-o-identity-e-o-work-order-locais).

## 👥 Autores

- [Guilherme da Rocha Salvador](https://github.com/guilhermesalvador404)
- [Lucas Almeida da Silva](https://github.com/lucas-almeida-silva)
- [Ramoon Lincoln Barros Camacho](https://github.com/ramooncamacho)
- [Renan Santana Camacho](https://github.com/renancamacho)

## 📄 Licença

Projeto acadêmico (FIAP — 15SOAT), para fins educacionais. Sem licença aberta
declarada (`UNLICENSED`).
