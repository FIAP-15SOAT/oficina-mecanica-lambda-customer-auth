# Como executar localmente

## Pré-requisitos

| Ferramenta | Versão | Necessária para |
| --- | --- | --- |
| Node.js | 24 ou superior | Tudo |
| Docker | — | Apenas a suíte de ponta a ponta (Testcontainers) |
| Um PostgreSQL com o schema da API | — | Autenticar de verdade (ver [Banco de dados](database.md)) |

**Nenhuma credencial de nuvem é necessária.** Os fallbacks de desenvolvimento
dispensam o gerenciador de segredos por completo: quando eles estão preenchidos,
o cliente da nuvem sequer é instanciado.

## Primeiro uso

```bash
cd app
npm ci
cp .env.example .env
```

O `.env.example` cobre todas as variáveis com valores de exemplo. Falta apenas a
chave privada de assinatura. Gere um par só seu:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/key.pem
node -e "console.log('CUSTOMER_JWT_PRIVATE_KEY=' + JSON.stringify(require('node:fs').readFileSync('/tmp/key.pem','utf8')))" >> .env
```

> O `.env` não é versionado, e nenhuma chave de assinatura vive neste
> repositório — ver [Segurança › Custódia da chave](security.md#custódia-da-chave).
>
> Um PEM não atravessa uma variável de ambiente com as quebras de linha
> intactas; a forma escapada (`\n`) é a única que `.env` transporta, e a
> validação de configuração a restaura.

## Executar a função

```bash
npm run invoke                      # usa events/login.event.json
npm run invoke -- events/outro.json # ou um evento seu
```

O comando executa o **ponto de entrada real** uma vez, com um evento no formato
que o gateway entrega, e imprime a resposta. É o mesmo ciclo de um
`sam local invoke -e evento.json`, sem exigir um descritor de funções que
competiria com o Terraform como fonte da verdade.

Para depurar, `NODE_OPTIONS=--inspect npm run invoke` e anexe o depurador.

O evento versionado em `app/events/login.event.json` é editável: trocar `cpf` e
`password` ali é o caminho mais curto para exercitar um cenário diferente.

## Banco de dados

A função lê `users`, `user_customers` e `customers`, e **este repositório não
possui DDL**. O schema pertence à API — ver [Banco de dados](database.md).

Para desenvolvimento diário, aponte `DATABASE_HOST`, `DATABASE_PORT` e
`DATABASE_NAME` para o PostgreSQL do ambiente local da API, que já está migrado
e semeado. Nada precisa ser alterado naquele repositório.

A suíte de ponta a ponta não depende disso: ela sobe um PostgreSQL efêmero por
Testcontainers e aplica as migrations executando a **imagem da API** como
migrador de uma passada. Produza a imagem uma vez, no repositório dela:

```bash
docker compose build migrate      # no repositório da API
npm run test:e2e                  # aqui
```

## Os dois repositórios juntos

Roteiro do zero para subir a API e a função e exercitar os dois fluxos de
autenticação. É o mesmo caminho que a verificação de interoperabilidade percorre.

### 1. Gerar o par de chaves

A função assina com a chave **privada**; a API verifica com a **pública**. As
duas metades precisam ser do mesmo par — não há descoberta de chave entre os
repositórios, e nenhuma chave é versionada em nenhum dos dois.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out customer-auth-private.pem
openssl rsa -pubout -in customer-auth-private.pem -out customer-auth-public.pem
```

Um `.env` não transporta quebra de linha, então as duas metades vão na forma
escapada (`\n`). Cada comando abaixo imprime o valor já pronto para colar, com
aspas:

```bash
node -e "console.log(JSON.stringify(require('node:fs').readFileSync('customer-auth-private.pem','utf8')))"
node -e "console.log(JSON.stringify(require('node:fs').readFileSync('customer-auth-public.pem','utf8')))"
```

### 2. Subir a API

```bash
git clone https://github.com/FIAP-15SOAT/oficina-mecanica-app.git
cd oficina-mecanica-app/app
git checkout feature/login-cpf   # enquanto o PR 65 não estiver integrado
cp .env.example .env
```

Em `app/.env`, a **metade pública** — as demais variáveis já têm padrão no
Compose:

```env
CUSTOMER_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

O `docker-compose.yml` da API traz `${CUSTOMER_JWT_PUBLIC_KEY:-...}` com um
**texto de exemplo**, não uma chave (`MIIB...`, com as reticências literais).
Não existe chave privada que corresponda a ele, então não há como pular este
passo: sem gerar o par, nenhum token emitido aqui é aceito. O `.env` é o lugar
certo para a chave — o Compose lê essa variável dele, e o `docker-compose.yml`
é versionado.

```bash
docker compose up -d --build
```

Sobe PostgreSQL, MailHog, o passo de migração com seed, e a API em
`http://localhost:3000` — Swagger em `/api/docs`. A imagem produzida aqui é a
mesma que a suíte de ponta a ponta desta função usa como migrador, então este
passo também satisfaz `npm run test:e2e`.

### 3. Configurar a função

```bash
cd ../../oficina-mecanica-lambda-customer-auth/app
npm ci
cp .env.example .env
```

Em `.env`, a **metade privada** e o endereço do PostgreSQL que o Compose
publicou:

```env
CUSTOMER_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=techchallenge
DATABASE_SSL=false
DATABASE_SECRET={"username":"postgres","password":"postgres"}
```

`CUSTOMER_JWT_ISSUER` e `CUSTOMER_JWT_AUDIENCE` já vêm no `.env.example` com os
valores acordados e precisam ser **idênticos** aos da API: `oficina-customer-auth`
e `oficina-api`. O verificador do outro lado os confere.

### 4. Autenticar pelo fluxo externo

O seed da API cria dois usuários com CPF, senha `Tech@2026` e vínculo com cliente
ativo:

| CPF | Usuário | Cliente vinculado |
| --- | --- | --- |
| `12345678909` | `joao.silva@email.com` | João da Silva — pessoa física |
| `98765432100` | `maria.souza@email.com` | Oficina Parceira LTDA — empresa |

Ajuste `cpf` e `password` em `app/events/login.event.json` e invoque:

```bash
npm run invoke
```

A resposta é o envelope de [Contrato](contracts.md#resposta-de-sucesso), com
`data.accessToken`.

### 5. Chamar a API com o token emitido

```bash
TOKEN=<data.accessToken>
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/me
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/me/work-orders
```

As rotas `/api/me/*` são a superfície do fluxo externo. As internas
(`/api/users`, `/api/work-orders`, `/api/customers`, …) **não** aceitam este
token: exigem o JWT interno, obtido em `POST /api/auth/login` com um dos
administradores do seed. Os dois fluxos são isolados por projeto — a matriz
completa de rotas está no README da API.

> **Se o login funciona aqui e a API devolve `401`,** a causa quase certa é
> `CUSTOMER_JWT_PUBLIC_KEY` não corresponder à privada usada na assinatura. A API
> **sobe normalmente** com uma chave que não confere, e o token externo é
> recusado com o mesmo `401` de uma credencial inválida. Emissor e audiência
> divergentes produzem exatamente o mesmo sintoma.

## Construir o artefato

```bash
npm run build       # dist/handler.js + dist/handler.js.map
```

O empacotamento em `.zip` **não** pertence a este repositório: quem monta o
artefato publicável é a change de infraestrutura, pelo `archive_file` do
Terraform, a partir de `dist/`.

O build falha se algum alias de importação sobreviver no pacote — um alias não
resolvido só quebraria na primeira invocação publicada.

## Variáveis de ambiente

Todas estão em `app/.env.example`, com comentário. Em resumo:

| Grupo | Variáveis |
| --- | --- |
| Geral | `NODE_ENV`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `SERVICE_VERSION` |
| Endpoint do banco | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` |
| Limites de tempo | `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_QUERY_TIMEOUT_MS` |
| Transporte cifrado | `DATABASE_SSL`, `DATABASE_SSL_CA` |
| Identificadores de segredo | `DATABASE_SECRET_ID`, `CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID` |
| Fallback (só fora de produção) | `DATABASE_SECRET`, `CUSTOMER_JWT_PRIVATE_KEY` |
| Token | `CUSTOMER_JWT_ISSUER`, `CUSTOMER_JWT_AUDIENCE`, `CUSTOMER_JWT_TTL_SECONDS`, `CUSTOMER_JWT_KEY_ID` |

`NODE_ENV` é **obrigatório** e aceita apenas `development`, `test` ou
`production`: é ele que decide se segredo em variável de ambiente e TLS
desligado são aceitos, e por isso não tem valor padrão. Em produção os dois
`*_SECRET_ID` são obrigatórios e os fallbacks são **recusados**.

Uma variável obrigatória ausente ou inválida **falha a composição**, com mensagem
nomeando cada problema. O ambiente não é abortado: enquanto a configuração
estiver inválida, toda invocação responde `500` no envelope documentado e
registra `app.configuration.invalid` — ver
[Arquitetura › Composição memoizada](architecture.md#composição-memoizada).

`DATABASE_SSL=false` existe para o PostgreSQL local, que não expõe TLS, e é
recusado em produção. A verificação de certificado nunca é desligada.
