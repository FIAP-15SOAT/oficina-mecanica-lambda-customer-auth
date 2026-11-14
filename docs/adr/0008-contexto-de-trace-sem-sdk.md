# ADR 0008: Contexto de trace sem SDK

## Status

Aceito — 2026-11-14

Emenda o [ADR 0005](0005-coleta-de-telemetria-sem-instrumentacao.md).

## Contexto

O [ADR 0005](0005-coleta-de-telemetria-sem-instrumentacao.md) decidiu não
instrumentar a função: ela era uma folha, sem chamar outro serviço, e as
durações que um trace mostraria já estavam na linha de log da invocação. O
gatilho de revisão dele era a função passar a encadear serviços.

Isso aconteceu: cada login agora chama o **Identity**, serviço que guarda os
usuários e as senhas, e o **work-order**, o serviço das ordens de serviço, que
guarda os clientes e os vínculos
([ADR 0007](0007-credencial-e-vinculo-verificados-nos-servicos-donos.md)). Os dois
são instrumentados com OpenTelemetry e continuam o trace que recebem no
cabeçalho `traceparent`, o formato do padrão W3C Trace Context para propagar um
trace entre serviços. A regra da solução é que toda chamada interna leve o
`traceparent` e o `x-request-id`.

Sem contexto de trace, o log da função e os traces dos dois serviços ficariam
sem ligação: o login apareceria nos serviços como um trace novo, sem nada que o
juntasse à linha da função.

A linha de log da função também tinha uma regra contrária, "sem identificador de
trace sintético": nenhuma linha carregava `trace_id`, porque um identificador sem
trace correspondente faria a plataforma procurar um trace que não existe.

## Decisão

A função gera um contexto de trace por invocação e o propaga, sem SDK:

- `traceparent` no formato `00-<trace id>-<span id>-01`, com o trace id de 16
  bytes aleatórios e o span id de 8 bytes aleatórios, em hexadecimal; o `01`
  marca o trace como amostrado;
- o `traceparent` e o `x-request-id` (o `request.id` da invocação) vão nas duas
  chamadas internas;
- o `trace_id` — os 32 caracteres hexadecimais, na grafia dos serviços — entra em
  toda linha de log da invocação, inclusive quando nenhuma chamada sai, como no
  `400` de entrada e no `500` de composição.

A função não abre span próprio, não carrega biblioteca de trace e mantém
`DD_TRACE_ENABLED=false` na camada de coleta. A regra "sem identificador de trace
sintético" deixa de valer: o trace existe, porque os dois serviços o continuam.

Sai também a medição das fases na linha da invocação (a duração da consulta ao
banco e a da verificação de senha, que deixaram de existir com o ADR 0007). A
duração de cada chamada aparece no span do Identity e no do work-order, com o
mesmo `trace_id`, e a chamada que falhou é nomeada no evento
`internal.call.failed`. Fica a duração total da invocação.

### O que muda no ADR 0005

A coleta continua sem instrumentação no código, como o ADR 0005 decidiu. Muda a
premissa de que a função é uma folha: ela gera e propaga o contexto de trace, e
a correlação ganha o `trace_id` como eixo, além do `request.id` e do
identificador de invocação.

## Alternativas descartadas

| Alternativa | Por que não | Rever se |
| --- | --- | --- |
| SDK OpenTelemetry na função, exportando para a camada de coleta | Paga o carregamento do SDK e do exportador na partida a frio para emitir um span só, cujo conteúdo — a duração de cada chamada — os spans dos serviços já mostram | A função passar a ter etapas próprias que valham span |
| Biblioteca de trace do Datadog com o invólucro do fornecedor | Além do custo de partida a frio, o ponto de entrada declarado passaria a ser o do fornecedor, a propriedade que o ADR 0005 preserva | O mesmo gatilho da linha acima, com o destino de telemetria mantido |
| Não propagar contexto de trace | O log da função e os traces dos serviços ficariam sem ligação, contra a regra da solução de propagar o contexto W3C em toda chamada interna | — |
| Medir cada chamada na linha da invocação | Mais campos no dicionário para um sinal que os spans dos serviços já dão | For preciso separar o tempo de rede até o NLB (o balanceador de rede interno do cluster) do tempo de resposta do serviço |

## Consequências

**Positivas.** O login aparece nos traces do Identity e do work-order com o
mesmo `trace_id` das linhas da função, e uma busca por esse valor junta os três.
Nenhuma dependência nova, nenhum custo de partida a frio.

**Negativas.** O span pai que o `traceparent` anuncia nunca é enviado ao
destino de telemetria: os spans dos serviços chegam como filhos de um span que
não existe, e o tempo gasto dentro da função não aparece no trace — só na linha
de log, como duração total. A diferença entre a rede até o NLB e o tempo de
resposta do serviço não é medida.

## Referências

- [Observabilidade › Os eixos de correlação](../observability.md#os-eixos-de-correlação)
- [Logging › Correlação](../logging.md#correlação)
- [Arquitetura › Correlação](../architecture.md#correlação)
