# Como executar localmente

A função depende de dois serviços da solução: o **Identity**, que guarda os
usuários e as senhas e verifica a credencial, e o **work-order**, o serviço das
ordens de serviço, que guarda os clientes e os vínculos entre usuário e cliente.
Localmente há dois caminhos para fazer esse papel:

- o **stub local**, um servidor HTTP de teste que imita as rotas internas dos dois
  serviços com respostas fixas — basta o Node.js;
- os **serviços locais**, o Identity e o work-order rodando nos ambientes Docker
  Compose de cada repositório — o caminho para ver o token aceito pelo work-order.

## Pré-requisitos

| Ferramenta | Versão | Necessária para |
| --- | --- | --- |
| Node.js | 24 ou superior | Tudo |
| Docker | — | Apenas o caminho com os serviços locais |

**Nenhuma credencial AWS é necessária.** O fallback de desenvolvimento da chave
privada dispensa o gerenciador de segredos por completo: quando ele está
preenchido, o cliente da nuvem sequer é instanciado.

## Primeiro uso

```bash
# Instalar as dependências na pasta da aplicação
cd app
npm ci
# Criar a configuração local a partir dos exemplos
cp .env.example .env
```

O `.env.example` cobre as variáveis locais com valores de exemplo, e as duas URLs
internas já apontam para o stub. Falta apenas a chave privada de assinatura.
Gere um par só seu:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out key.pem
node -e "console.log('CUSTOMER_JWT_PRIVATE_KEY=' + JSON.stringify(require('node:fs').readFileSync('key.pem','utf8').replace(/\r/g,'')))" >> .env
```

> O `.env` e o `key.pem` não são versionados (o `.gitignore` ignora `*.pem`), e nenhuma chave de assinatura vive neste
> repositório — ver [Segurança › Custódia da chave](security.md#custódia-da-chave).
>
> Um PEM não atravessa uma variável de ambiente com as quebras de linha
> intactas; a forma escapada (`\n`) é a única que `.env` transporta, e a
> validação de configuração a restaura.

## Com o stub local

Em um terminal, suba o stub:

```bash
npm run stub
```

Ele escuta na porta 4010, serve as duas rotas internas e imprime as duas URLs —
o mesmo endereço que o `.env.example` já usa, `http://localhost:4010`:

```
IDENTITY_INTERNAL_URL=http://127.0.0.1:4010
WORK_ORDER_INTERNAL_URL=http://127.0.0.1:4010
```

Em outro terminal, também em `app/`, invoque a função:

```bash
npm run invoke                      # usa events/login.event.json
npm run invoke -- events/outro.json # ou um evento seu
```

O comando executa o **ponto de entrada real** uma vez, com um evento no formato
que o API Gateway entrega, e imprime a resposta. É o mesmo ciclo de um
`sam local invoke -e evento.json`, sem exigir um descritor de funções que
competiria com o Terraform como fonte da verdade.

O stub conhece um único cliente, o mesmo que `app/events/login.event.json` envia:

| CPF | Senha | Resposta do Identity | Resposta do work-order |
| --- | --- | --- | --- |
| `123.456.789-09` | `Tech@2026` | `200` com o `userId` da fixture do Identity | `200` com a lista de clientes da fixture do work-order |
| qualquer outro, ou outra senha | — | `401` | não é chamado |

As respostas vêm das fixtures — arquivos JSON com uma resposta de exemplo de cada
rota, publicados pelo Identity e pelo work-order e copiados para
`app/test/contracts/`. Trocar `cpf` ou `password` no evento exercita a recusa
(`401`); parar o stub exercita a indisponibilidade (`503`).

Para depurar, `NODE_OPTIONS=--inspect npm run invoke` e anexe o depurador.

## Com o Identity e o work-order locais

Roteiro do zero para subir os dois serviços e a função e usar o token emitido
nas rotas do cliente no Identity e no work-order.

### 1. Gerar o par de chaves

A função assina com a chave **privada**; o Identity e o work-order verificam
com a **pública**. As duas metades precisam ser do mesmo par — não há descoberta de
chave entre os repositórios, e nenhuma chave é versionada em nenhum deles.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out customer-auth-private.pem
openssl rsa -pubout -in customer-auth-private.pem -out customer-auth-public.pem
```

Um `.env` não transporta quebra de linha, então as duas metades vão na forma
escapada (`\n`). Cada comando abaixo imprime o valor já pronto para colar, com
aspas:

```bash
node -e "console.log(JSON.stringify(require('node:fs').readFileSync('customer-auth-private.pem','utf8').replace(/\r/g,'')))"
node -e "console.log(JSON.stringify(require('node:fs').readFileSync('customer-auth-public.pem','utf8').replace(/\r/g,'')))"
```

### 2. Subir o Identity

```bash
git clone https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service.git
cd oficina-mecanica-identity-service/app
cp .env.example .env
```

O Identity não sobe sem quatro chaves no `app/.env`: a **metade pública** do
passo 1, que valida o token de cliente, e os dois pares do token de
funcionário, que ele mesmo assina (access e refresh). Os comandos abaixo geram
os pares de funcionário, gravam as quatro chaves e apagam os arquivos de
funcionário, que o work-order não usa:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out staff-access.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out staff-refresh.pem
openssl pkey -in staff-access.pem -pubout -out staff-access.pub.pem
node -e "
const read = (file) => JSON.stringify(require('node:fs').readFileSync(file, 'utf8').replace(/\r/g, ''));
console.log('STAFF_JWT_PUBLIC_KEY=' + read('staff-access.pub.pem'));
console.log('STAFF_JWT_PRIVATE_KEY=' + read('staff-access.pem'));
console.log('STAFF_JWT_REFRESH_PRIVATE_KEY=' + read('staff-refresh.pem'));
console.log('CUSTOMER_JWT_PUBLIC_KEY=' + read('../../customer-auth-public.pem'));
" >> .env
rm staff-access.pem staff-access.pub.pem staff-refresh.pem
docker compose up -d --build --wait
```

Sobe o PostgreSQL do Identity, o passo de migração com seed e o serviço em
`http://localhost:3001`. O seed cria dois clientes com CPF e senha `Tech@2026`:

| CPF | Usuário |
| --- | --- |
| `12345678909` | `joao.silva@email.com` |
| `98765432100` | `maria.souza@email.com` |

### 3. Subir o work-order

```bash
git clone https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service.git
cd oficina-mecanica-work-order-service/app
cp .env.example .env
```

Em `app/.env`, troque o valor de `CUSTOMER_JWT_PUBLIC_KEY` pela **metade
pública** do passo 1:

```env
CUSTOMER_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

O work-order também valida o token de funcionário, assinado pelo Identity:
copie para o `.env` a chave pública de funcionário que o passo 2 gravou no
Identity. As demais variáveis já têm padrão no Compose.

```bash
grep '^STAFF_JWT_PUBLIC_KEY=' ../../oficina-mecanica-identity-service/app/.env >> .env
```

O `docker-compose.yml` do work-order traz `${CUSTOMER_JWT_PUBLIC_KEY:-...}` com
um **texto de exemplo**, não uma chave (`MIIB...`, com as reticências literais).
Não existe chave privada que corresponda a ele, então não há como pular este
passo: sem gerar o par, nenhum token emitido aqui é aceito.

```bash
docker compose up -d --build
```

Sobe o PostgreSQL do work-order, o passo de migração com seed e o serviço em
`http://localhost:3000` — Swagger em `/api/docs`. O seed cria os clientes e os
vínculos dos dois usuários do Identity.

### 4. Configurar a função

```bash
cd ../../oficina-mecanica-lambda-customer-auth/app
npm ci
cp .env.example .env
```

Em `.env`, a **metade privada** e as URLs dos dois serviços, que o
`.env.example` traz comentadas:

```env
CUSTOMER_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
IDENTITY_INTERNAL_URL=http://localhost:3001
WORK_ORDER_INTERNAL_URL=http://localhost:3000
```

`CUSTOMER_JWT_ISSUER` e `CUSTOMER_JWT_AUDIENCE` já vêm no `.env.example` com os
valores acordados e precisam ser **idênticos** aos do work-order:
`oficina-customer-auth` e `oficina-api`. O verificador do outro lado os confere.

### 5. Autenticar pelo fluxo externo

`app/events/login.event.json` já envia o CPF e a senha do João. Invoque:

```bash
npm run invoke
```

A resposta é o envelope de [Contrato](contracts.md#resposta-de-sucesso), com
`data.accessToken`.

### 6. Chamar o Identity e o work-order com o token emitido

```bash
TOKEN="<data.accessToken>"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/me
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/me/work-orders
```

`GET /api/me` é do Identity: devolve o perfil do usuário e, em `customers`, só
as empresas que ele representa — para o João, que só tem o próprio cadastro de
pessoa física, a lista vem vazia. `GET /api/me/work-orders` é do work-order e
lista as ordens de serviço dos clientes vinculados.

As rotas `/api/me/*` são a superfície do fluxo externo. As internas
(`/api/work-orders`, `/api/customers`, …) **não** aceitam este token: exigem o
JWT interno dos funcionários. Os dois fluxos são isolados — a matriz completa de
rotas está no README do work-order.

> **Se o login funciona aqui e o work-order devolve `401`,** a causa quase certa
> é `CUSTOMER_JWT_PUBLIC_KEY` não corresponder à privada usada na assinatura. O
> work-order **sobe normalmente** com uma chave pública válida que não
> corresponde à privada, e o token externo é recusado com o mesmo `401` de uma
> credencial inválida. Emissor e audiência divergentes produzem exatamente o
> mesmo sintoma.

## Construir o artefato

```bash
npm run build       # dist/handler.js + dist/handler.js.map
```

O empacotamento em `.zip` não acontece aqui: quem monta o artefato publicável é
o `archive_file` da stack em [`infra/`](../infra/), a partir de `dist/`,
no momento da aplicação. Uma única fonte de verdade para o conteúdo e para o
identificador de conteúdo — ver
[ADR 0004](adr/0004-empacotamento-e-publicacao.md).

O build falha se algum alias de importação sobreviver no pacote — um alias não
resolvido só quebraria na primeira invocação publicada.

## Variáveis de ambiente

Todas estão em `app/.env.example`, com comentário. Em resumo:

| Grupo | Variáveis |
| --- | --- |
| Geral | `NODE_ENV`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `SERVICE_VERSION` |
| Serviços internos | `IDENTITY_INTERNAL_URL`, `WORK_ORDER_INTERNAL_URL` |
| Identificador de segredo | `CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID` |
| Fallback (só fora de produção) | `CUSTOMER_JWT_PRIVATE_KEY` |
| Token | `CUSTOMER_JWT_ISSUER`, `CUSTOMER_JWT_AUDIENCE`, `CUSTOMER_JWT_TTL_SECONDS`, `CUSTOMER_JWT_KEY_ID` |

`IDENTITY_INTERNAL_URL` e `WORK_ORDER_INTERNAL_URL` são obrigatórias e aceitam
apenas `http` ou `https`; uma barra final na URL não muda a rota chamada. Na
AWS, a stack as monta a partir do NLB interno — ver
[Infraestrutura](terraform.md#variáveis-de-ambiente-da-função).

`NODE_ENV` é **obrigatório** e aceita apenas `development`, `test` ou
`production`: é ele que decide se a chave privada em variável de ambiente é
aceita, e por isso não tem valor padrão. Em produção
`CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID` é obrigatório e o fallback é **recusado**.

Uma variável obrigatória ausente ou inválida **falha a composição**, com mensagem
nomeando cada problema. O ambiente não é abortado: enquanto a configuração
estiver inválida, toda invocação responde `500` no envelope documentado e
registra `app.configuration.invalid` — ver
[Arquitetura › Composição memoizada](architecture.md#composição-memoizada).
