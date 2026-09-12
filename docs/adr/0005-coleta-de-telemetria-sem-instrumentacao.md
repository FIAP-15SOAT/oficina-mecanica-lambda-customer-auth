# ADR 0005: Coleta de telemetria sem instrumentação no código

## Status

Aceito — 2026-09-08

## Contexto

A função já emite sinal: **uma linha estruturada por invocação**, com duração
total, duração da consulta ao banco, duração da verificação de senha, indicador
de partida a frio e atributos de execução. A plataforma produz invocações,
erros, duração e estrangulamento por conta própria. A correlação já tem dois
eixos — o identificador vindo do API Gateway e o identificador de invocação da
plataforma.

O que falta é **coleta**: o sinal sai em stdout e para no registro de log da
plataforma, onde ninguém o lê junto com o resto da solução.

Duas restrições decidem quase tudo:

1. **O laboratório não permite criar roles.** Está registrado no ADR 0001 do
   repositório de Kubernetes e materializado no padrão de variável de repositório
   que alimenta os nomes de role pré-existentes.
2. **A função é uma folha:** não chama outro serviço. As durações que um trace
   distribuído produziria já constam da linha de invocação.

O critério vem do próprio ADR de telemetria da API: *a lacuna dominante não é
instrumentação, é coleta*.

## Decisão

Anexar a camada de coleta do fornecedor como layer e configurá-la por variáveis
de ambiente. **Nenhuma mudança em `src/`** — nem dependência, nem invólucro de
ponto de entrada, nem biblioteca de instrumentação, nem chamada de fornecedor. O
ponto de entrada declarado da função continua sendo o da aplicação.

A camada fica atrás de um interruptor próprio, e o destino e a versão da camada
são constantes versionadas na infraestrutura.

É o mesmo desenho da API, onde a aplicação emite sinal neutro e um agente
separado traduz para o destino: **o fornecedor vive na coleta, nunca no código**.

## Alternativas

| Abordagem | Trace | Métrica própria | Log | Código muda? | Partida a frio | Viável no laboratório |
| --- | --- | --- | --- | --- | --- | --- |
| **Extensão sozinha** | inferido | via extensão | ✅ | **não** | ~100–200 ms de inicialização, com envio após a resposta | ✅ |
| Extensão + biblioteca do fornecedor + invólucro | completo | ✅ | ✅ | **o ponto de entrada passa a ser o do fornecedor** | maior | ✅ |
| Extensão + kit neutro exportando para a extensão | ✅ | ❌ não suportado por essa via | ✅ | preload e três campos novos no dicionário | +200–800 ms | ✅ |
| Coletor neutro gerenciado pela nuvem | ✅ | ✅ | — | kit + configuração do coletor | o maior | ✅ |
| Integração de conta puxando métricas e logs | — | ✅ | ✅ | não | zero | ❌ **exige criar role** |
| Encaminhador de logs por função dedicada | — | — | ✅ | não | zero | ❌ **a pilha cria roles** |

As duas últimas linhas são as mais baratas em partida a frio e estão **fora de
alcance** pela mesma proibição: criar role.

A terceira é a mais tentadora por ser neutra de fornecedor, e é recusada por
custo sem contrapartida: paga partida a frio numa função **folha**, cujas
durações já constam da linha de invocação, e a via não aceita métrica própria —
irrelevante aqui, porque esta função não emite nenhuma.

A segunda entrega trace completo ao preço de o ponto de entrada declarado deixar
de ser o da aplicação, que é exatamente a propriedade que este ADR existe para
preservar.

## Consequências

**Positivas.** O sinal que já existe passa a ser lido junto com o resto da
solução, sem uma linha de código novo. Trocar de destino muda a camada anexada e
as variáveis de ambiente, e nada mais. A superfície de dependências da função —
relevante numa função de segurança sujeita a varredura — não cresce.

**Negativas.** Sem trace distribuído nem gráfico de chama. A correlação
permanece pelos dois eixos existentes. A credencial do destino fica legível na
configuração da função, registrado em [Segurança](../security.md).

**Verificação.** A disponibilidade da coleta só é conclusiva empiricamente:
confirmar que a função aparece no destino depois de uma invocação. Um
provisionamento verde não prova nada, e a ausência da função no destino é falha
**da coleta**, distinta de falha da função.

**Gatilho para reabrir.** Se a função passar a chamar outro serviço — deixando de
ser folha —, a terceira linha da tabela passa a se pagar, e a decisão volta à
mesa.

## Referências

- [Observabilidade](../observability.md)
- [Logging](../logging.md)
- [Infraestrutura › Variáveis de ambiente da função](../terraform.md#variaveis-de-ambiente-da-funcao)
- ADR de telemetria da API (`docs/adr/0005-opentelemetry.md`, em
  `oficina-mecanica-api`) — o critério de que a lacuna dominante é coleta
