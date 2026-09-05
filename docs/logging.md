# Logging

JSON estruturado em stdout, com o **mesmo envelope e o mesmo dicionário fechado
de campos** da API principal, acrescido dos atributos próprios de execução
serverless. O objetivo é concreto: uma única consulta cobre os dois serviços.

## Envelope

Toda linha é um objeto JSON independente, terminado por quebra de linha.

| Chave | Valor |
| --- | --- |
| `timestamp` | ISO-8601 em **UTC** (`Z`) |
| `level` | rótulo textual (`info`, `warn`, `error`) — nunca o nível numérico |
| `message` | texto estável, **nunca** interpolado com dado de negócio |

A linha emitida uma vez por invocação usa a mensagem `http request` — a **mesma**
que a API usa no registro por requisição. É o que faz uma expressão de busca
alcançar os dois serviços.

## Escrita síncrona, stdout e nada mais

Nenhum transporte de fornecedor é declarado, e nenhuma biblioteca de Datadog,
New Relic ou equivalente está na árvore de dependências. O processo escreve no
descritor 1 e a coleta é responsabilidade da infraestrutura. Trocar de
plataforma de observabilidade não exige mudança de código.

A escrita é **síncrona**, por uma razão específica deste ambiente e mais forte
que a que motivou a mesma escolha na API: o ambiente é congelado assim que a
resposta retorna, e uma escrita bufferizada pode ficar retida e sair apenas na
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
automatizada**. Vários campos são condicionais por natureza (as durações de fase,
`error.type`, `exception.stacktrace`), e travá-la exigiria uma lista de exceções
mantida à mão: exatamente o metamodelo que este documento evita mais abaixo.

Os nomes seguem as Semantic Conventions do OpenTelemetry onde a convenção define
o conceito, e usam o namespace próprio `oficina.*` apenas onde ela não define
nada.

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

### Atendimento

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `http.request.method` | string | baixa | `invocation-log.builder` | clear |
| `http.response.status_code` | number | baixa | `invocation-log.builder` | clear |

### Durações

| Campo | Tipo | Cardinalidade | Componente | Sensibilidade |
| --- | --- | --- | --- | --- |
| `oficina.faas.invocation.duration_ms` | number | alta | `invocation-log.builder` | clear |
| `oficina.db.query.duration_ms` | number | alta | `invocation-timings` | clear (condicional) |
| `oficina.auth.password.verification.duration_ms` | number | alta | `invocation-timings` | clear (condicional) |

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
| `oficina.auth.failure.reason` | string | baixa | caso de uso / borda | clear |
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
| `auth.customer.input.rejected` | warn | `failureReason` | caso de uso (CPF) / borda (transporte) |
| `db.query.failed` | error | — (`exception.*`) | ponto de entrada |
| `auth.customer.token.signing.failed` | error | — (`exception.*`) | ponto de entrada |
| `app.configuration.invalid` | error | — (`exception.*`) | composição |
| `app.initialization.failed` | error | — (`exception.*`) | composição |
| `http request` (linha do atendimento) | derivado do status | método, status, três durações e, quando há falha, o erro | ponto de entrada |
| `idle database client failed` (sem nome de evento) | error | — (`exception.*`) | composição — ouvinte de erro do pool |

O nível da linha do atendimento decorre do status: `>= 500` → `error`,
`>= 400` → `warn`, caso contrário `info`.

Três linhas não carregam `request.id` nem os atributos `faas.*`: os dois eventos
de composição e o de cliente ocioso. Elas saem do logger do **ambiente**, e não
do da invocação — o de cliente ocioso porque acontece entre invocações, e os de
composição porque a composição roda também no aquecimento do Init, antes de
existir invocação alguma. Quando a composição é retentada dentro de uma
invocação, o evento continua vindo daquele logger, e quem carrega a correlação é
a linha do atendimento que sai logo em seguida.

`failureReason` distingue as quatro causas de recusa de credencial —
`unknown_user`, `inactive_user`, `wrong_password`, `no_active_customer_link` — e
as cinco de entrada inválida — `invalid_cpf`, `missing_body`, `malformed_body`,
`body_too_large`, `invalid_credentials`.

Não há razão para método nem para `Content-Type`: a função deliberadamente não
recusa por nenhum dos dois — o roteamento é do gateway.

Um erro inesperado não ganha evento próprio: a linha do atendimento já sai em
nível de erro, com `error.type` e `exception.*`.

## Correlação

`request.id` — **o mesmo nome que a API usa**, porque é a chave de junção entre
os dois serviços.

O valor vem do cabeçalho `x-request-id` ou `x-correlation-id` quando há um
válido (alfanumérico com `.`, `_`, `:`, `-`, até 128 caracteres, e que sobrevive
intacto ao saneador de texto). Sem cabeçalho, o identificador da invocação
assume o papel, o que mantém a linha ligada ao que a plataforma registra por
conta própria. Sem nenhum dos dois, um identificador é gerado — nenhuma linha de
invocação sai sem chave. As três linhas do ambiente, listadas acima, são a
exceção, porque não pertencem a invocação alguma.

## Inicialização a frio

`faas.coldstart` é **campo presente em todas as linhas**, e não um evento
separado. A razão é prática: fatiar a latência por essa condição não pode exigir
uma segunda consulta correlacionada. A primeira invocação de um ambiente marca
`true` em todas as suas linhas; as seguintes marcam `false`.

## As três durações

A verificação de senha em JavaScript puro é o **termo dominante** da latência
desta função. Sem separá-la da consulta e do total, uma invocação lenta é um
número sem diagnóstico, e o dimensionamento de memória vira adivinhação — a CPU
da plataforma escala com a memória alocada, então essa é a única alavanca que
importa.

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

## Falha do próprio logger

Uma falha no mecanismo de log **não** interrompe a invocação nem altera a
resposta. O canal de diagnóstico é o `stderr`, distinto do canal de saída dos
logs — reportar a falha pelo mesmo caminho que acabou de quebrar arrisca
recursão, e quando o que falhou é o `stdout`, logar lá é garantir silêncio.

O relato identifica a **etapa** e o **campo**, e nunca o valor que causou a
falha: essa linha não pode virar a via de vazamento que a redação existe para
evitar.

## Sem identificador de rastro sintético

Enquanto não houver tracing distribuído, nenhuma linha carrega `trace_id` ou
`span_id`. Um identificador vazio ou inventado faz a plataforma tentar
correlacionar com um rastro que não existe, o que é pior que a ausência do
campo. `request.id` é a chave de junção e permanece nomeada; quando ids reais
existirem, nada precisa ser renomeado.

## Divergências deliberadas em relação à API

O envelope e a mecânica são idênticos. O que muda é o **conteúdo**, e cada
diferença tem razão:

| Campo da API | Decisão aqui | Por quê |
| --- | --- | --- |
| `host.name`, `process.pid`, `service.instance.id` | **Não emitidos** | Sem sentido em ambiente efêmero; `faas.*` cumpre o papel |
| `http.route`, `url.path`, `url.query`, `url.scheme` | **Não emitidos** | O roteamento é do gateway e a função serve um caminho só |
| `client.address` | **Não emitido** | Endereço do chamador é do gateway; aqui só chegaria o do próprio gateway |
| `user.id`, `user.roles` | **Não emitidos** | O chamador é anônimo por definição — este é o endpoint de login |
| `oficina.auth.subject.name`, `.email` | **Não emitidos** | A consulta sequer os recupera; não buscar é melhor que mascarar |
| `http.request.header.*` | **Não emitidos** | Nenhum deles participa de diagnóstico aqui |
| `oficina.http.server.request.duration_ms` | Renomeado para `oficina.faas.invocation.duration_ms` | Reflete invocação, não requisição de servidor |
| — | `oficina.db.query.duration_ms` **acrescentado** | Sem ela, uma invocação lenta é um número sem diagnóstico |
| — | `oficina.auth.password.verification.duration_ms` **acrescentado** | É o termo dominante da latência |
| — | `oficina.auth.subject.cpf_masked` **acrescentado** | Correlator estável por CPF, agrupável |
| — | `faas.*` e `cloud.*` **acrescentados** | Semantic Conventions da execução serverless |
| Sequências de segredo | **Idênticas** | O corpo nunca é registrado, então não há nome de campo novo a classificar |

## Procedência do código copiado

O subsistema de redação, o serializador de erro, o normalizador de registro e o
registro de campos são **cópia deliberada e limitada** da API
(`oficina-mecanica-app`, `app/src/infrastructure/logging/`). A procedência é
registrada **aqui**, e não em cabeçalho de cada arquivo: repetir o bloco em cinco
arquivos poluía o código sem acrescentar informação que este parágrafo não dê.

**Gatilho de extração para pacote compartilhado: quando um terceiro serviço
precisar deste subsistema.**

Um pacote compartilhado agora criaria um terceiro repositório, processo de versão
e gestão de defasagem para apenas dois consumidores. Contra a divergência
silenciosa — que é o risco real da cópia — valem a procedência declarada e a
asserção de que toda chave emitida pertence ao dicionário.
