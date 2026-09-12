<div align="center">

# 🔐 Oficina Mecânica · Customer Auth

**Autenticação de clientes por CPF e senha, em função serverless.** Recebe uma
credencial, decide, e emite o token que a API principal já sabe verificar.

![Node](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![AWS Lambda](https://img.shields.io/badge/AWS%20Lambda-FF9900?logo=awslambda&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
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
orçamentos. A API principal já verifica o token externo por uma estratégia
dedicada e já administra os vínculos entre pessoa e cliente, mas **nenhum
componente emite esse token**: o fluxo de autenticação externa foi
deliberadamente extraído para uma função serverless. É esta.

## 🎯 Responsabilidade

**O que a função faz**

- Expõe `POST /customer-auth/login`, recebendo `{ cpf, password }`.
- Normaliza e valida o CPF, localiza o usuário, verifica a senha contra o hash
  bcrypt existente, exige conta ativa e **ao menos um vínculo com cliente ativo**.
- Emite um JWT **RS256** com exatamente `sub`, `iss`, `aud`, `iat` e `exp`, mais
  `kid` no cabeçalho. Validade configurável, padrão 3600 s. Sem refresh token.

**O que ela não faz**

Não cria usuário, não define ou altera senha, não administra vínculos, não
escreve no banco e **não chama a API principal** para autenticar — se a API
estiver fora do ar, a autenticação externa continua funcionando.

**Uma propriedade que a define**

- **Mensagem única** para toda falha de credencial: CPF inexistente, conta
  inativa, senha incorreta e ausência de vínculo produzem resposta idêntica.
- **Sem escrita**: a função não cria usuário, não altera senha e não administra
  vínculo. Ela lê uma linha e assina um token.

## 🧰 Stack

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Runtime | Node.js 24 · TypeScript | Mesma stack da API |
| Banco | `pg` (driver), pool de tamanho 1 | Uma consulta de leitura — [ADR 0001](docs/adr/0001-driver-em-vez-de-orm.md) |
| Assinatura | `jose` | Zero dependências transitivas; chave importada na inicialização |
| Hash | `bcryptjs` (JavaScript puro) | Módulo nativo não executa na plataforma — [ADR 0003](docs/adr/0003-bcrypt-em-javascript-puro.md) |
| Log | `pino`, stdout síncrono | Envelope e dicionário compatíveis com os da API |
| Configuração | `zod` | Falha na inicialização, não por requisição |
| Build | `esbuild` → pacote único CJS | Sem código nativo; o `.zip` é montado pelo Terraform |
| Testes | Jest · Testcontainers | Unitário e ponta a ponta — [Testes](docs/testing.md) |

Nenhuma dependência de runtime é módulo nativo, o que mantém o artefato
portátil.

## ⚙️ Pré-requisitos

- **Node.js 24+**
- **Docker** (apenas para a suíte de ponta a ponta)
- Um **PostgreSQL com o schema da API** — o schema pertence a ela e não é
  recriado aqui

Nenhuma credencial de nuvem é necessária para desenvolver.

## 🚀 Início rápido

```bash
cd app
npm ci
cp .env.example .env

# chave privada de teste — gere a sua; nenhuma é versionada
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/key.pem
node -e "console.log('CUSTOMER_JWT_PRIVATE_KEY=' + JSON.stringify(require('node:fs').readFileSync('/tmp/key.pem','utf8')))" >> .env

npm run invoke        # executa o ponto de entrada com events/login.event.json
```

Não há servidor HTTP local: a função é exercitada pela invocação avulsa, com um
evento no formato que o gateway entrega. Trocar `cpf` e `password` em
`app/events/login.event.json` é o caminho mais curto para outro cenário.

Passo a passo completo, incluindo como reusar o banco que o ambiente local da API
já subiu, em [Como executar localmente](docs/local-setup.md).

## 📜 Comandos

Todos rodam a partir de `app/`.

| Comando | O que faz |
| --- | --- |
| `npm run invoke` | Invoca o ponto de entrada **uma** vez, a partir de `events/login.event.json` |
| `npm run build` | Pacote único em CommonJS, com mapa de origem, em `dist/` |
| `npm test` | Suíte unitária — sem entrada e saída, sem contêiner, sem rede |
| `npm run test:cov` | Unitária com cobertura; exige 100% nas quatro métricas |
| `npm run test:e2e` | Ponta a ponta contra PostgreSQL real, migrado pela imagem da API |
| `npm run lint` | ESLint + Prettier, incluindo a cerca entre camadas |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Aplica a formatação |

## 📁 Estrutura do Repositório

```text
.
├── .github/workflows/           # CI, SAST e CD da função
├── app/
│   ├── src/
│   │   ├── domain/              # Entidades, contratos e regras de domínio
│   │   ├── application/         # Casos de uso e portas
│   │   ├── interface-adapters/  # Controller e apresentação do login
│   │   └── infrastructure/      # Handler, banco, JWT, logging e telemetria
│   ├── test/                    # Testes unitários e E2E
│   ├── events/                  # Eventos para execução local
│   ├── scripts/                 # Scripts de apoio à aplicação
│   ├── .env.example            # Referência de configuração local
│   └── package.json            # Dependências e comandos npm
├── docs/
│   ├── adr/                    # Decisões arquiteturais
│   ├── diagrams/               # PNGs renderizados na documentação
│   ├── architecture.md         # Arquitetura e fluxo de autenticação
│   ├── ci-cd.md                # Workflows, jobs, steps e configuração GitHub
│   └── terraform.md            # Recursos, inputs, outputs e aplicação local
├── terraform/                  # Função AWS Lambda e integrações
├── .gitignore
└── README.md
```

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| 📄 [Contrato](docs/contracts.md) | **Normativo e autocontido**: rota, corpo, envelope de sucesso, tabela de erros, claims, algoritmo, validade e identificador de chave |
| 🏛️ [Arquitetura](docs/architecture.md) | Camadas, portas, composição memoizada, fluxo de invocação, árvore de diretórios e as divergências em relação à API |
| 🗄️ [Banco de dados](docs/database.md) | A consulta, ciclo de vida da conexão, limites de tempo, TLS, caminho de rede e orçamento de conexões |
| 🔒 [Segurança](docs/security.md) | Modelo de ameaças, anti-enumeração, anti-temporização, custódia da chave, e o que a limitação do gateway **não** protege |
| 📊 [Logging](docs/logging.md) | Envelope, dicionário completo, eventos, níveis e a tabela de divergências |
| 💻 [Como executar localmente](docs/local-setup.md) | A invocação avulsa, o banco pela imagem da API, e a convivência com o ambiente local dela |
| 🧪 [Testes](docs/testing.md) | Os dois níveis, propriedades travadas por teste e cobertura |
| 🔁 [CI/CD](docs/ci-cd.md) | Os três workflows, cada job e o que o reprova, os dois portões pós-implantação, o inventário de configuração externa e o guia de solução de problemas |
| ☁️ [Infraestrutura](docs/terraform.md) | O que a stack provisiona, a fronteira entre repositórios, o consumo de state remoto e o contrato de output da credencial do banco |
| 🔭 [Observabilidade](docs/observability.md) | Os sinais que a função produz, a camada que os coleta, os dois eixos de correlação e o que não é instrumentado |
| 📐 [ADR 0001](docs/adr/0001-driver-em-vez-de-orm.md) | Driver em vez de ORM |
| 📐 [ADR 0002](docs/adr/0002-camadas-enxutas-com-composicao-memoizada.md) | Camadas enxutas com composição memoizada |
| 📐 [ADR 0003](docs/adr/0003-bcrypt-em-javascript-puro.md) | bcrypt em JavaScript puro, artefato compactado e execução local |
| 📐 [ADR 0004](docs/adr/0004-empacotamento-e-publicacao.md) | Empacotamento e publicação da função |
| 📐 [ADR 0005](docs/adr/0005-coleta-de-telemetria-sem-instrumentacao.md) | Coleta de telemetria sem instrumentação no código |
| 📐 [ADR 0006](docs/adr/0006-sem-analise-dinamica.md) | Sem análise dinâmica de segurança neste repositório |

## 🧩 Ecossistema

| Repositório | Papel | Relação com esta função |
| --- | --- | --- |
| `oficina-mecanica-api` | API principal (NestJS) | **Dona do schema** e da identidade. Verifica o token emitido aqui, com uma estratégia separada da interna. Sua imagem é usada como migrador do banco local e de teste |
| `oficina-mecanica-infra-base` | Rede | Dona da VPC e das subnets privadas às quais esta função é anexada |
| `oficina-mecanica-infra-database` | Banco | Dono da instância e da credencial. Expõe endereço, porta, nome e o identificador do segredo por output |
| `oficina-mecanica-api-gateway` | API Gateway | Publica `POST /customer-auth/login` e consome [`docs/contracts.md`](docs/contracts.md). Esta stack concede a autorização de invocação |
| `oficina-mecanica-infra-k8s` | Cluster | Executa a API principal. Não participa desta função |
| **`oficina-mecanica-lambda-customer-auth`** | **Esta função** | Emite o token externo, e é dona da própria stack de infraestrutura |

O modelo de identidade — `users.cpf`, `user_customers`, `customers.is_active` —
é definido e mantido pela API. O racional está no ADR de autenticação de clientes
daquele repositório (`docs/adr/0004-autenticacao-de-clientes.md`). Este
repositório **lê** esse modelo e não contém DDL algum.

## 📦 Estado

- A função é implementada em camadas enxutas, coberta por suíte unitária com
  **100% nas quatro métricas** e por suíte de ponta a ponta contra o schema real
  mantido pela API.
- A esteira valida toda mudança em seis verificações paralelas, a análise
  estática impõe o seu portão de qualidade, e a entrega provisiona a função e a
  publica — terminando em **dois portões**: a invocação real e a chamada à rota
  pública, ambas exigindo recusa de credencial.
- A infraestrutura vive em [`terraform/`](terraform/): a função em subnets
  privadas, o seu grupo de segurança, o grupo de log, o segredo da chave de
  assinatura, a concorrência reservada e a autorização de invocação concedida à
  API Gateway.
- `POST /customer-auth/login` é atendida pela função, e o token emitido aqui é
  aceito pela estratégia `customer-jwt` da API. Passo a passo em
  [Como executar localmente](docs/local-setup.md#os-dois-repositórios-juntos).

## 👥 Autores

- [Guilherme da Rocha Salvador](https://github.com/guilhermesalvador404)
- [Lucas Almeida da Silva](https://github.com/lucas-almeida-silva)
- [Ramoon Lincoln Barros Camacho](https://github.com/ramooncamacho)
- [Renan Santana Camacho](https://github.com/renancamacho)

## 📄 Licença

Projeto acadêmico (FIAP — 15SOAT), para fins educacionais. Sem licença aberta
declarada (`UNLICENSED`).
