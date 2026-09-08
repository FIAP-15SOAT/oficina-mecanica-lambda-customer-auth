# Observabilidade

A função emite sinal neutro; uma camada separada o traduz para o destino.
Nenhuma linha de `src/` conhece o fornecedor.

## O que a função produz

### Uma linha estruturada por invocação

Exatamente uma, com tudo o que responde "onde o tempo foi gasto":

| Campo | O que carrega |
| --- | --- |
| Duração total | Do início ao fim da invocação |
| Duração da consulta | A única ida ao banco |
| Duração da verificação de senha | Termo tipicamente dominante da latência |
| Indicador de partida a frio | Se este ambiente de execução é novo |
| Atributos de execução | Identificador de invocação, nome, versão e instância da função, memória, região e identificador do recurso |
| Atributos de recurso | Nome, namespace, **versão** e ambiente do serviço |

A versão do serviço é o identificador do commit implantado, injetado pela
entrega. Toda linha responde "qual código está em execução" sem consultar a
nuvem.

### Eventos nomeados

Recusa de entrada, falha de consulta, configuração inválida, falha de assinatura,
falha de inicialização — cada um com nome de catálogo, e sem credencial nem dado
pessoal em texto puro. Detalhes em [Logging](logging.md).

### O que a plataforma produz sozinha

Invocações, erros, duração, estrangulamento e partidas a frio. São métricas da
plataforma, preservadas como estão: a aplicação **não** as reimplementa.

## A camada que coleta

Uma extensão da plataforma, anexada como layer e configurada por variáveis de
ambiente. **Zero mudança no código da função** — nem dependência, nem invólucro
de ponto de entrada, nem biblioteca de instrumentação, nem chamada de
fornecedor. O ponto de entrada declarado continua sendo o da aplicação.

É o mesmo desenho da API, onde a aplicação emite sinal neutro e um agente
separado traduz para o destino. Trocar de destino muda a camada anexada e as
variáveis de ambiente, e nada mais.

| | |
| --- | --- |
| Interruptor | `ENABLE_TELEMETRY_COLLECTION`, no environment de produção |
| Credencial do destino | `DD_API_KEY`, segredo do environment |
| Destino e versão da camada | Variáveis da infraestrutura com valor padrão versionado |

Com o interruptor desligado, a função é provisionada **sem** a camada e opera
normalmente. Com ele ligado e a credencial ausente, a entrega reprova indicando
qual credencial falta — uma camada anexada que não entrega nada seria pior que
nenhuma.

Destino e versão da camada são constantes versionadas, e não variáveis do
provedor: revisáveis no Pull Request, com diferença visível, sem estado escondido
na configuração. Alterá-los exige um commit, que é a propriedade desejada.

A credencial do destino vai como variável de ambiente da função, em paridade com
a API — onde a mesma credencial é um Secret do cluster, legível por quem tiver
permissão de leitura no espaço de nomes. Aqui é legível por quem puder ler a
configuração da função. O fornecedor recomenda guardá-la no gerenciador de
segredos e referenciá-la por identificador; isso acrescentaria um recurso e uma
leitura por partida a frio para uma diferença que este ambiente não realiza.
Registrado em [Segurança](security.md).

## Os dois eixos de correlação

Ambos já existem — nenhum identificador sintético é criado para suprir a ausência
de trace.

| Eixo | Liga |
| --- | --- |
| Identificador de correlação recebido do API Gateway | API Gateway → função → API. O mesmo identificador aparece nos registros dos três |
| Identificador de invocação da plataforma | A linha da aplicação ao registro de invocação no destino de telemetria |

## O que deliberadamente não é instrumentado

Nem trace distribuído, nem exportador de trace, nem métrica de negócio.

**A função é uma folha:** não chama outro serviço. As durações que um trace
produziria — banco e verificação de senha — **já constam da linha de invocação**,
e o custo de partida a frio de um kit de instrumentação não se paga contra sinal
que já existe.

O critério é o que o próprio ADR de telemetria da API estabelece: *a lacuna
dominante não é instrumentação, é coleta*.

**Gatilho para reabrir:** se a função passar a chamar outro serviço — deixando de
ser folha —, um kit neutro exportando para a extensão passa a se pagar, e a
decisão volta à mesa. Ver
[ADR 0005](adr/0005-coleta-de-telemetria-sem-instrumentacao.md).

## Verificação da coleta

**A confirmação é empírica e não tem substituto.** Depois de uma invocação,
verificar que a função aparece no destino de telemetria.

Um provisionamento verde com o interruptor ligado não prova que a camada
entrega. Quando a função não aparece, a falha é **da coleta** — distinta de falha
da função, que continuaria visível no registro de log da plataforma.

Duas conferências fecham o quadro:

1. Uma linha de log da função implantada carrega o identificador do commit em
   execução no atributo de versão de serviço.
2. A mesma linha carrega o identificador de correlação recebido do API Gateway.
