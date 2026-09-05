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

A função serve **um único caminho e um único método**. O roteamento, o
autorizador e a limitação de frequência são responsabilidade do gateway: a
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
| `password` | string | Obrigatório. Comparado com o hash bcrypt armazenado. |

`123.456.789-09`, `123 456 789 09` e `12345678909` são o **mesmo** CPF para
efeito de consulta. Um CPF reprovado na validação produz `400` e **não** origina
consulta ao banco.

Campos adicionais no corpo são ignorados.

## Resposta de sucesso

`200 OK`, `content-type: application/json`, `cache-control: no-store`

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImN1c3RvbWVyLWF1dGgtMjAyNi0wOCJ9...",
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

O papel interno do usuário é ignorado: um funcionário com vínculos externos
autentica por este fluxo, e um usuário sem papel interno também.

## Tabela de erros

Todo corpo de erro tem exatamente três campos, no mesmo formato que a API
principal usa:

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
| `503` | `Service Unavailable` | `Serviço temporariamente indisponível` | Banco indisponível ou estouro de limite de tempo |
| `500` | `Internal Server Error` | `An unexpected error occurred` | Falha ao assinar o token, ou erro não previsto |

### A resposta `401` é sempre a mesma

As quatro causas de recusa de credencial — CPF inexistente, conta inativa, senha
incorreta e ausência de vínculo com cliente ativo — produzem **status, corpo e
mensagem idênticos**. A causa específica é registrada apenas em log. Nada na
resposta permite descobrir se um CPF existe no sistema.

O **tempo de resposta**, porém, não é equivalente: as recusas anteriores à
verificação de senha retornam mais rápido. É um canal lateral conhecido e
aceito, alinhado ao comportamento da API — ver
[Segurança](security.md#enumeração-por-temporização--risco-aceito).

### O que nunca aparece em uma resposta de erro

Endereço, porta, cadeia de conexão, nome de tabela, mensagem do driver de banco,
detalhe de chave e pilha de execução. As mensagens de `500` e `503` são
constantes: nada vindo da exceção é repassado ao cliente.

## O token emitido

### Cabeçalho JOSE

```json
{ "alg": "RS256", "kid": "<identificador da chave>" }
```

O `kid` está presente desde a primeira versão. A estratégia de verificação da
API, configurada com uma chave estática, pode ignorá-lo; sem ele, introduzir
rotação depois exigiria uma janela em que a API aceitasse dois formatos de
token.

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
| Chave pública | distribuída à API |
| Independência | a chave é independente de qualquer segredo da autenticação interna |
| Validade padrão | 3600 segundos, configurável |

A validade é mais longa que a do token interno porque não existe refresh
externo. A mitigação está do outro lado: a API recarrega o estado do usuário e
consulta o vínculo a cada requisição, então desativar uma conta ou remover um
vínculo vale imediatamente, sem lista de revogação.

### O que o verificador precisa checar

Algoritmo `RS256`, assinatura pela chave pública correspondente, `iss`, `aud` e
`exp`. Um token externo nunca deve ser aceito pelo verificador da autenticação
interna, e vice-versa.

## Limites de responsabilidade

A função verifica credencial e emite token. Ela **não** cria usuário, **não**
define ou altera senha, **não** administra vínculos entre usuário e cliente e
**não** chama a API principal para autenticar. Nenhuma escrita é feita no banco
em nenhum caminho, de sucesso ou de falha.
