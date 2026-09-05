<div align="center">

# 🔐 Oficina Mecânica · Customer Auth

**Autenticação de clientes por CPF e senha, em função serverless.** Recebe uma
credencial, decide, e emite o token que a API principal já sabe verificar.

![Node](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![AWS Lambda](https://img.shields.io/badge/AWS%20Lambda-FF9900?logo=awslambda&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Cobertura](https://img.shields.io/badge/cobertura-100%25-brightgreen)

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

## 📚 Documentação

| Documento | Conteúdo |
| --- | --- |
| 📄 [Contrato](docs/contracts.md) | **Normativo e autocontido**: rota, corpo, envelope de sucesso, tabela de erros, claims, algoritmo, validade e identificador de chave |
| 🏛️ [Arquitetura](docs/architecture.md) | Camadas, portas, composição memoizada, fluxo de invocação, árvore de diretórios e as divergências em relação à API |
| 🗄️ [Banco de dados](docs/database.md) | A consulta, ciclo de vida da conexão, limites de tempo, TLS, e as dívidas de privilégio e de intermediador |
| 🔒 [Segurança](docs/security.md) | Modelo de ameaças, anti-enumeração, anti-temporização, custódia da chave, e o que a limitação do gateway **não** protege |
| 📊 [Logging](docs/logging.md) | Envelope, dicionário completo, eventos, níveis e a tabela de divergências |
| 💻 [Como executar localmente](docs/local-setup.md) | A invocação avulsa, o banco pela imagem da API, e a convivência com o ambiente local dela |
| 🧪 [Testes](docs/testing.md) | Os dois níveis, propriedades travadas por teste e cobertura |
| 📐 [ADR 0001](docs/adr/0001-driver-em-vez-de-orm.md) | Driver em vez de ORM |
| 📐 [ADR 0002](docs/adr/0002-camadas-enxutas-com-composicao-memoizada.md) | Camadas enxutas com composição memoizada |
| 📐 [ADR 0003](docs/adr/0003-bcrypt-em-javascript-puro.md) | bcrypt em JavaScript puro, artefato compactado e execução local |

## 🧩 Ecossistema

| Repositório | Papel | Relação com esta função |
| --- | --- | --- |
| `oficina-mecanica-app` | API principal (NestJS) | **Dona do schema** e da identidade. Verifica o token emitido aqui, com uma estratégia separada da interna. Sua imagem é usada como migrador do banco local e de teste |
| `oficina-mecanica-gateway` | API Gateway | Publicará a rota e consumirá [`docs/contracts.md`](docs/contracts.md) |
| **`oficina-mecanica-lambda-customer-auth`** | **Esta função** | Emite o token externo |

O modelo de identidade — `users.cpf`, `user_customers`, `customers.is_active` —
é definido e mantido pela API. O racional está no ADR de autenticação de clientes
daquele repositório (`docs/adr/0004-autenticacao-de-clientes.md`). Este
repositório **lê** esse modelo e não contém DDL algum.

## 🚧 Estado

- A função está implementada e coberta por testes unitários (100% nas quatro
  métricas) e de ponta a ponta.
- A suíte de **ponta a ponta** depende da change da API que introduz
  `users.cpf`, `customers.is_active` e `user_customers`. Ela vive na branch
  `feature/login-cpf` (PR 65) e ainda não foi integrada: até lá, a imagem
  migradora precisa ser produzida a partir dessa branch. Contra qualquer schema
  anterior a suíte falha — por projeto: é exatamente o sinal que ela existe para
  dar.
- A **interoperabilidade** com a API foi verificada de ponta a ponta contra essa
  branch: o token emitido aqui é aceito pela estratégia `customer-jwt` dela.
  Passo a passo em [Como executar localmente](docs/local-setup.md#os-dois-repositórios-juntos).
- Infraestrutura, exposição pública e esteira ficam para changes próprias.
  `infra/` está reservado. Até lá, **nenhum token externo real é emitido**.

## 👥 Autores

- [Guilherme da Rocha Salvador](https://github.com/guilhermesalvador404)
- [Lucas Almeida da Silva](https://github.com/lucas-almeida-silva)
- [Ramoon Lincoln Barros Camacho](https://github.com/ramooncamacho)
- [Renan Santana Camacho](https://github.com/renancamacho)

## 📄 Licença

Projeto acadêmico (FIAP — 15SOAT), para fins educacionais. Sem licença aberta
declarada (`UNLICENSED`).
