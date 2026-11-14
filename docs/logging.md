# Logging

JSON estruturado em stdout (a saída padrão do processo), com o **mesmo envelope e
o mesmo dicionário fechado de campos** dos serviços NestJS da solução — entre
eles o Identity, que verifica a credencial, e o work-order, que confere o
vínculo —, acrescido dos atributos próprios de execução serverless. O objetivo é
concreto: uma única consulta cobre a função e os serviços.

## Envelope

Toda linha é um objeto JSON independente, terminado por quebra de linha.

| Chave | Valor |
| --- | --- |
| `timestamp` | ISO-8601 em **UTC** (`Z`) |
| `level` | rótulo textual (`info`, `warn`, `error`) — nunca o nível numérico |
| `message` | texto estável, **nunca** interpolado com dado de negócio |

A linha emitida uma vez por invocação usa a mensagem `http request` — a **mesma**
que os serviços usam no registro por requisição. É o que faz uma expressão de
busca alcançar a função e os serviços.

## Escrita síncrona, stdout e nada mais

Nenhum transporte de fornecedor é declarado, e nenhuma biblioteca de Datadog,
New Relic ou equivalente está na árvore de dependências. O processo escreve no
stdout e a coleta é responsabilidade da infraestrutura. Trocar de plataforma de
observabilidade não exige mudança de código.

A escrita é **síncrona**, por uma razão específica deste ambiente e mais forte
que a que motivou a mesma escolha nos serviços: o ambiente é congelado assim que
a resposta retorna, e uma escrita bufferizada pode ficar retida e sair apenas na
invocação seguinte — ou nunca.

## Dicionário fechado

Todo atributo emitido consta de um registro que fixa **nome, tipo,
cardinalidade, componente responsável e sensibilidade**
(`app/src/infrastructure/logging/field-registry.ts`). Um atributo não declarado é
**descartado** antes de a linha sair.

A razão é operacional: um campo cujo tipo varia entre registros faz o índice
derrubar o evento inteiro, não só o campo. Um atributo novo que escape sem
declaração chega ao armazenamento com tipo indefinido.

Uma asserção sustenta o registro na direção que importa — **nada escapa**: toda
chave emitida durante os testes pertence ao dicionário, afirmado no nível
unitário (`handler-logging.spec.ts`) e no de ponta a ponta
(`customer-auth.e2e-spec.ts`).

A direção recíproca — todo campo declarado ser emitido por algum evento — **não é
automatizada**. Vários campos são condicionais por natureza (`error.type`,
`exception.stacktrace`, `oficina.auth.subject.id`), e travá-la exigiria uma lista
de exceções mantida à mão: exatamente o metamodelo que este documento evita mais
abaixo.

Os nomes seguem as Semantic Conventions do OpenTelemetry (a convenção de nomes de
atributos do padrão OpenTelemetry) onde a convenção define o conceito, e usam o
namespace próprio `oficina.*` apenas onde ela não define nada.

## Dicionário completo

Cada campo fixa **nome, tipo, cardinalidade, componente responsável e
sensibilidade**. A cardinalidade orienta o custo de indexação na plataforma de
observabilidade; o componente é quem emite o campo, e portanto onde mexer.

### Envelope

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `timestamp` | string | alta | `logger.factory` | clear |
| `level` | string | baixa | `logger.factory` | clear |
| `message` | string | baixa | `logger.factory` | clear |

### Identificação do serviço

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `service.name` | string | baixa | `logger.config` | clear |
| `service.namespace` | string | baixa | `logger.config` | clear |
| `service.version` | string | baixa | `logger.config` | clear |
| `deployment.environment.name` | string | baixa | `logger.config` | clear |

### Execução serverless e nuvem

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `faas.invocation_id` | string | alta | `execution-attributes` | identifier |
| `faas.coldstart` | boolean | baixa | `execution-attributes` | clear |
| `faas.name` | string | baixa | `execution-attributes` | clear |
| `faas.version` | string | baixa | `execution-attributes` | clear |
| `faas.instance` | string | média | `execution-attributes` | identifier |
| `faas.max_memory` | number (bytes) | baixa | `execution-attributes` | clear |
| `cloud.provider` | string | baixa | `execution-attributes` | clear |
| `cloud.platform` | string | baixa | `execution-attributes` | clear |
| `cloud.region` | string | baixa | `execution-attributes` | clear |
| `cloud.resource_id` | string | baixa | `execution-attributes` | identifier |

### Correlação

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `request.id` | string | alta | `correlation` | identifier |
| `trace_id` | string | alta | `trace-context` | identifier |

### Atendimento

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `http.request.method` | string | baixa | `invocation-log.builder` | clear |
| `http.response.status_code` | number | baixa | `invocation-log.builder` | clear |

### Duração

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `oficina.faas.invocation.duration_ms` | number | alta | `invocation-log.builder` | clear |

### Erro

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `error.type` | string | baixa | `error-serializer` | clear (condicional) |
| `oficina.error.message` | string | média | `error-serializer` | sanitized (condicional) |
| `exception.type` | string | baixa | `error-serializer` | clear (condicional) |
| `exception.message` | string | média | `error-serializer` | sanitized (condicional) |
| `exception.stacktrace` | string | alta | `error-serializer` | sanitized (condicional) |

### Negócio

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `oficina.event.name` | string | baixa | catálogos de evento | clear |
| `oficina.auth.subject.id` | string | alta | caso de uso | identifier |
| `oficina.auth.failure.reason` | string | baixa | caso de uso / handler | clear |
| `oficina.auth.subject.cpf_masked` | string | alta | caso de uso | **pii** |

Em runtime, o que o código precisa é o nome declarado — que decide o descarte em
`field-registry.ts` — e a sensibilidade, que decide o mascaramento. Tipo,
cardinalidade e componente vivem aqui porque não têm consumidor executável:
transformá-los em estrutura de código criaria um metamodelo cujo único leitor
seria um teste afirmando que ele existe.

## Eventos

**No máximo duas linhas por invocação:** a do atendimento, sempre, e no máximo
um evento adicional.

| Evento | Nível | Campos | Emissor |
| --- | --- | --- | --- |
| `auth.customer.authentication.succeeded` | info | `subjectId`, `maskedCpf` | caso de uso |
| `auth.customer.authentication.failed` | warn | `failureReason`, `maskedCpf`, `subjectId?` | caso de uso |
| `auth.customer.input.rejected` | warn | `failureReason` | caso de uso (CPF) / handler (transporte) |
| `internal.call.failed` | error | — (`exception.*`) | ponto de entrada |
| `auth.customer.token.signing.failed` | error | — (`exception.*`) | ponto de entrada |
| `app.configuration.invalid` | error | — (`exception.*`) | composição |
| `app.initialization.failed` | error | — (`exception.*`) | composição |
| `http request` (linha do atendimento) | derivado do status | método, status, duração total e, quando há falha, o erro | ponto de entrada |

O nível da linha do atendimento decorre do status: `>= 500` → `error`,
`>= 400` → `warn`, caso contrário `info`.

`internal.call.failed` sai quando a chamada ao Identity ou ao work-order falha —
tempo esgotado, conexão recusada, redirect, 4xx fora do contrato ou 5xx — e a
resposta é `503`. A chamada que falhou está em `exception.message`:
`Falha na chamada interna <método> <rota>`, mais `com status <n>` quando houve
resposta, por exemplo `Falha na chamada interna POST /internal/customer-authentications com status 500`.

Duas linhas não carregam `request.id`, `trace_id` nem os atributos `faas.*`: os
dois eventos de composição. Elas saem do logger do **ambiente**, e não do da
invocação, porque a composição roda também no aquecimento do Init, antes de
existir invocação alguma. Quando a composição é retentada dentro de uma
invocação, o evento continua vindo daquele logger, e quem carrega a correlação é
a linha do atendimento que sai logo em seguida.

`failureReason` distingue as duas etapas de recusa de credencial —
`credential_refused`, quando o Identity recusa a credencial, e
`no_active_customer_link`, quando o work-order não devolve cliente ativo, com o
`subjectId` do usuário — e as cinco de entrada inválida — `invalid_cpf`,
`missing_body`, `malformed_body`, `body_too_large`, `invalid_credentials`. A
causa da recusa da credencial (CPF inexistente, conta inativa ou senha
incorreta) fica no log do Identity, com o mesmo `trace_id`.

Não há razão para método nem para `Content-Type`: a função deliberadamente não
recusa por nenhum dos dois — o roteamento é do API Gateway.

Um erro inesperado não ganha evento próprio: a linha do atendimento já sai em
nível de erro, com `error.type` e `exception.*`.

## Correlação

Toda linha da invocação leva duas chaves de junção.

**`request.id`** — **o mesmo nome que os serviços usam**, porque permite a junção
com o API Gateway quando o ID recebido é aceito, e com o Identity e o work-order,
que o recebem no cabeçalho `x-request-id` das chamadas internas.

O valor vem do cabeçalho `x-request-id` ou `x-correlation-id` quando há um
válido (alfanumérico com `.`, `_`, `:`, `-`, até 128 caracteres, e que sobrevive
intacto ao saneador de texto). Sem cabeçalho, o identificador da invocação
assume o papel, o que mantém a linha ligada ao que a plataforma registra por
conta própria. Sem nenhum dos dois, um identificador é gerado — nenhuma linha de
invocação sai sem chave. As duas linhas do ambiente, listadas acima, são a
exceção, porque não pertencem a invocação alguma.

**`trace_id`** — os 32 caracteres hexadecimais do trace, na mesma grafia dos
serviços. A função gera um contexto de trace por invocação e o envia no
cabeçalho `traceparent` (o formato do padrão W3C Trace Context) das duas chamadas
internas; o Identity e o work-order continuam esse trace, então os spans deles e
as linhas desta função se juntam pelo mesmo `trace_id`. A linha sai com
`trace_id` inclusive quando nenhuma chamada acontece — no `400` de entrada e no
`500` de composição. A função não emite span próprio — ver
[ADR 0008](adr/0008-contexto-de-trace-sem-sdk.md).

O login na função e a requisição posterior ao work-order com o token emitido são
atendimentos distintos, com identificadores próprios.

## Inicialização a frio

`faas.coldstart` é **campo presente nas linhas do logger de invocação**, e não um evento
separado. A razão é prática: fatiar a latência por essa condição não pode exigir
uma segunda consulta correlacionada. A primeira invocação de um ambiente marca
`true` em todas as suas linhas; as seguintes marcam `false`.

## Redação

Segredo é **removido**. Dado pessoal é **mascarado preservando a forma**. A
classificação acontece pelo **nome do campo**, sem mascaramento explícito no
ponto de chamada.

O CPF é emitido como campo declarado próprio, com sensibilidade `pii`: a chamada
passa a forma pontuada e o adaptador a reduz a `***.***.789-09`. Isso revela
três dígitos além dos verificadores — que já são deriváveis dos nove primeiros.
Não identifica ninguém, e é um correlator estável, que é precisamente o sinal
desejado. Como **campo declarado**, a plataforma consegue agrupar tentativas por
CPF; dentro de uma cadeia de caracteres serializada, não conseguiria.

O corpo da requisição **nunca** é registrado. Classificar por nome de campo
funciona para os nomes previstos, mas o corpo é controlado pelo cliente: uma
credencial repetida sob uma chave semanticamente neutra atravessaria a
classificação inteira. Como o diagnóstico de um `400` já é coberto pela causa
nomeada (`oficina.auth.failure.reason`), pelo status e pelo CPF mascarado, não
sobra informação operacional que justifique registrar o payload.

O mesmo vale para a chamada ao Identity que falha: o erro do cliente HTTP guarda
o corpo enviado, com a senha, mas o serializador de erro registra só tipo,
mensagem saneada e pilha, nunca o corpo da requisição.

## Falha do próprio logger

Uma falha no mecanismo de log **não** interrompe a invocação nem altera a
resposta. O canal de diagnóstico é o `stderr` (a saída de erro do processo),
distinto do canal de saída dos logs — reportar a falha pelo mesmo caminho que
acabou de quebrar arrisca recursão, e quando o que falhou é o `stdout`, logar lá
é garantir silêncio.

O relato identifica a **etapa** e o **campo**, e nunca o valor que causou a
falha: essa linha não pode virar a via de vazamento que a redação existe para
evitar.

## Divergências deliberadas em relação aos serviços

O envelope e a mecânica são idênticos. O que muda é o **conteúdo**, e cada
diferença tem razão:

| Campo dos serviços | Decisão aqui | Por quê |
| --- | --- | --- |
| `host.name`, `process.pid`, `service.instance.id` | **Não emitidos** | Sem sentido em ambiente efêmero; `faas.*` cumpre o papel |
| `http.route`, `url.path`, `url.query`, `url.scheme` | **Não emitidos** | O roteamento é do API Gateway e a função serve um caminho só |
| `client.address` | **Não emitido** | Endereço do chamador é do API Gateway; o payload 2.0 contém `requestContext.http.sourceIp`, mas o dicionário local não o publica |
| `user.id`, `user.roles` | **Não emitidos** | O chamador é anônimo por definição — este é o endpoint de login |
| `oficina.auth.subject.name`, `.email` | **Não emitidos** | O Identity devolve só o `userId`; não buscar é melhor que mascarar |
| `http.request.header.*` | **Não emitidos** | Nenhum deles participa de diagnóstico aqui |
| `span_id` | **Não emitido** | A função não abre span próprio |
| `trace_id` do SDK OpenTelemetry | Gerado pela função, mesma grafia | Sem SDK; o Identity e o work-order continuam o trace recebido |
| `oficina.http.server.request.duration_ms` | Renomeado para `oficina.faas.invocation.duration_ms` | Reflete invocação, não requisição de servidor |
| — | `oficina.auth.subject.cpf_masked` **acrescentado** | Correlator estável por CPF, agrupável |
| — | `faas.*` e `cloud.*` **acrescentados** | Semantic Conventions da execução serverless |
| Sequências de segredo | **Idênticas** | O corpo nunca é registrado, então não há nome de campo novo a classificar |

## Procedência do código copiado

O subsistema de redação, o serializador de erro, o normalizador de registro e o
registro de campos são **cópia deliberada e limitada** do work-order
(`oficina-mecanica-work-order-service`, `app/src/infrastructure/logging/`). A
procedência é registrada **aqui**, e não em cabeçalho de cada arquivo: repetir o
bloco em cinco arquivos poluía o código sem acrescentar informação que este
parágrafo não dê.

**Gatilho de extração para pacote compartilhado: quando um terceiro serviço
precisar deste subsistema.**

Um pacote compartilhado agora criaria um terceiro repositório, processo de versão
e gestão de defasagem para apenas dois consumidores. Contra a divergência silenciosa — que é o risco
real da cópia — valem a procedência declarada e a asserção de que toda chave
emitida pertence ao dicionário.
