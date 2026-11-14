# Contrato da autenticação externa

> **Documento normativo e autocontido.** Ele declara o contrato por extenso e
> não depende de nenhum outro arquivo para ser lido ou implementado. O
> repositório do API Gateway consome **este** documento.

## Rota

| | |
| --- | --- |
| Método | `POST` |
| Caminho | `/customer-auth/login` |
| Exposição | pública, sem autenticação prévia |
| Tamanho máximo do corpo | 4096 bytes |

A função serve **um único caminho e um único método**. O roteamento e a limitação de frequência são responsabilidade do gateway,
que não declara authorizer nesta rota de login: a
função não repete essas checagens, e por isso não recusa por método nem por
`Content-Type`.

## Corpo da requisição

```json
{
  "cpf": "12345678909",
  "password": "Senha@123"
}
```

| Campo | Tipo | Regra |
| --- | --- | --- |
| `cpf` | string | Obrigatório. **Todo** caractere não numérico é removido antes de qualquer uso; o resultado precisa ter exatamente 11 dígitos, não pode ser uma sequência de dígitos idênticos e precisa satisfazer os dois dígitos verificadores. |
| `password` | string | Obrigatório. Enviado ao Identity, o serviço que guarda os usuários e as senhas, que o compara com o hash da senha guardado por ele. |

`123.456.789-09`, `123 456 789 09` e `12345678909` são o **mesmo** CPF para
efeito de autenticação. Um CPF reprovado na validação produz `400` e **não**
origina chamada ao Identity nem ao work-order.

Campos adicionais no corpo são ignorados.

## Resposta de sucesso

`200 OK`, `content-type: application/json`, `cache-control: no-store`

```json
{
  "data": {
    "accessToken": "<JWT RS256 emitido pela função>",
    "expiresIn": 3600
  }
}
```

| Campo | Tipo | Significado |
| --- | --- | --- |
| `data.accessToken` | string | O JWT descrito abaixo. |
| `data.expiresIn` | number | Validade do token, em segundos. |

O esquema de autenticação não viaja no corpo: é sempre `Bearer`, e o consumidor
monta `Authorization: Bearer <accessToken>`.

A resposta **não contém** CPF, e-mail, nome do usuário nem identificador de
cliente, em nenhum campo.

## Condições que concedem o token

O token é emitido apenas quando **todas** forem verdadeiras:

1. existe usuário com o CPF informado;
2. a senha confere com o hash armazenado;
3. a conta do usuário está ativa;
4. existe **ao menos um** vínculo do usuário com um cliente **ativo**.

As três primeiras são conferidas pelo Identity; a quarta, pelo work-order, o
serviço das ordens de serviço, que guarda os clientes e os vínculos — ver
[Chamadas internas](#chamadas-internas).

O papel interno do usuário é ignorado: um funcionário com vínculos externos
autentica por este fluxo, e um usuário sem papel interno também.

## Tabela de erros

Todo corpo de erro tem exatamente três campos, no mesmo formato que os serviços
da solução usam:

```json
{ "statusCode": 401, "error": "Unauthorized", "message": "Credenciais inválidas" }
```

| Status | `error` | `message` | Quando |
| --- | --- | --- | --- |
| `400` | `Bad Request` | `Corpo da requisição ausente` | Requisição sem corpo |
| `400` | `Bad Request` | `Corpo da requisição não é um JSON de objeto válido` | JSON inválido, ou um valor que não é objeto |
| `400` | `Bad Request` | `Corpo da requisição excede o tamanho aceito` | Corpo acima de 4096 bytes |
| `400` | `Bad Request` | `Informe cpf e password como texto` | Campo obrigatório ausente, vazio ou com tipo incorreto |
| `400` | `Bad Request` | `CPF é obrigatório` | `cpf` presente, porém só com espaços |
| `400` | `Bad Request` | `CPF inválido` | CPF reprovado na validação |
| `401` | `Unauthorized` | `Credenciais inválidas` | **Qualquer** falha de credencial |
| `503` | `Service Unavailable` | `Serviço temporariamente indisponível` | Identity ou work-order indisponível, sem resposta em 2 s, ou com resposta fora do contrato (5xx, redirect, 4xx que não o `401` do Identity, ou sucesso sem o `userId` do Identity ou sem a lista do work-order) |
| `500` | `Internal Server Error` | `Ocorreu um erro inesperado` | Falha ao assinar o token, ou erro não previsto |

### A resposta `401` é sempre a mesma

As quatro causas de recusa de credencial — CPF inexistente, conta inativa, senha
incorreta e ausência de vínculo com cliente ativo — produzem **status, corpo e
mensagem idênticos**. A etapa da recusa (credencial recusada pelo Identity ou
nenhum cliente ativo no work-order) é registrada apenas no log desta função, e a
causa específica da credencial, no log do Identity. Nada na resposta permite
descobrir se um CPF existe no sistema.

O **tempo de resposta**, porém, não é equivalente: as recusas anteriores à
verificação de senha no Identity retornam mais rápido, e a ausência de vínculo,
que exige a chamada ao work-order, retorna mais devagar. É um canal lateral
conhecido e aceito — ver
[Segurança](security.md#enumeração-por-temporização--risco-aceito).

### O que nunca aparece em uma resposta de erro

Endereço, porta, URL ou rota interna, status devolvido pelo Identity ou pelo
work-order, mensagem do cliente HTTP, detalhe de chave e pilha de execução. As mensagens de `500` e `503` são
constantes: nada vindo da exceção é repassado ao cliente.

## O token emitido

### Cabeçalho JOSE

```json
{ "alg": "RS256", "kid": "<identificador da chave>" }
```

O `kid` está presente desde a primeira versão. A estratégia de verificação do
work-order, configurada com uma chave estática, pode ignorá-lo; sem ele,
introduzir rotação depois exigiria uma janela em que o work-order aceitasse dois
formatos de token.

### Claims

```json
{
  "sub": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "iss": "oficina-customer-auth",
  "aud": "oficina-api",
  "iat": 1787932800,
  "exp": 1787936400
}
```

| Claim | Valor |
| --- | --- |
| `sub` | Identificador do usuário (UUID). |
| `iss` | `oficina-customer-auth` — configurável, este é o valor acordado. |
| `aud` | `oficina-api` — configurável, este é o valor acordado. |
| `iat` | Instante da emissão, em segundos desde a época. |
| `exp` | `iat` + validade. |

O conjunto é **exatamente** esse. O token **não** contém CPF, e-mail,
identificador de cliente, papel interno nem qualquer claim que indique o fluxo
de autenticação: o fluxo já é determinado por `iss`, `aud` e algoritmo, que são
verificados. Não existe refresh token externo.

### Assinatura e validade

| | |
| --- | --- |
| Algoritmo | `RS256` (assimétrico) |
| Chave privada | conhecida somente pela função |
| Chave pública | distribuída ao work-order |
| Independência | a chave é independente de qualquer segredo da autenticação interna |
| Validade padrão | 3600 segundos, configurável |

A validade é mais longa que a do token interno porque não existe refresh
externo. A mitigação está do outro lado: o work-order confere o vínculo a cada
requisição, então remover um vínculo vale imediatamente, sem lista de
revogação.

### O que o verificador precisa checar

Algoritmo `RS256`, assinatura pela chave pública correspondente, `iss`, `aud` e
`exp`. Um token externo nunca deve ser aceito pelo verificador da autenticação
interna, e vice-versa.

## Chamadas internas

A função depende de duas rotas internas, alcançadas pelo NLB (Network Load
Balancer, o balanceador de rede interno do cluster Kubernetes onde os serviços
rodam). Elas não são públicas: o API Gateway não as publica.

| Ordem | Serviço | Chamada | Respostas tratadas |
| --- | --- | --- | --- |
| 1 | Identity | `POST /internal/customer-authentications` com `{ "cpf": "<11 dígitos>", "password": "<senha>" }` | `200 { "data": { "userId": "<uuid>" } }` aceita a credencial; `401`, com qualquer corpo, a recusa |
| 2 | work-order | `GET /internal/users/<userId>/customers` | `200 { "data": [ ... ] }`, a lista dos clientes ativos vinculados ao usuário; lista vazia recusa a credencial |

A segunda chamada só acontece quando a primeira aceita a credencial. As duas:

- esperam no máximo **2 segundos** pela resposta;
- abrem uma conexão nova e pedem `Connection: close`, sem reaproveitar conexão
  entre invocações;
- não seguem redirect;
- levam o cabeçalho `x-request-id`, com o identificador da requisição da borda,
  e o cabeçalho `traceparent`, com o contexto de trace W3C (o formato padrão de
  propagação de trace entre serviços) gerado pela função para a invocação.

Qualquer outro desfecho — tempo esgotado, conexão recusada, redirect, resposta
5xx ou 4xx fora da tabela — responde `503` ao cliente. Os formatos de cada
resposta são os das fixtures que os serviços publicam: arquivos JSON com uma
resposta de exemplo da rota, copiados para `app/test/contracts/` e usados pelos
testes desta função.

## Limites de responsabilidade

A função pede a verificação da credencial ao Identity, confere os vínculos no
work-order e emite o token. Ela **não** cria usuário, **não** define ou altera
senha, **não** administra vínculos entre usuário e cliente e **não** acessa banco
de dados. Nenhuma escrita é feita em outro serviço em nenhum caminho, de sucesso
ou de falha.
