# ADR 0006: Sem análise dinâmica de segurança neste repositório

## Status

Aceito — 2026-09-08

## Contexto

A API principal da solução tem um workflow de análise dinâmica de segurança. A
pergunta natural, ao montar a esteira desta função, é se ela deve ter o seu.

A resposta exige olhar o que a análise dinâmica mede: ela varre **uma superfície
HTTP em execução**, procurando cabeçalhos ausentes, respostas que ecoam entrada,
tratamento de método, comportamento sob carga malformada.

Esta função não tem uma.

## Decisão

Não existe workflow de análise dinâmica neste repositório.

Quatro razões independentes — cada uma bastaria:

1. **A função não expõe superfície HTTP própria.** Ela é invocada por integração
   do API Gateway, por chamada de serviço, e a execução local é invocação avulsa em
   processo. Não há servidor a varrer.
2. **Não há especificação neste repositório.** O contrato desta função é prosa
   normativa; a especificação que descreve a rota `POST /customer-auth/login`
   pertence ao repositório do gateway.
3. **Fabricar um alvo mediria a coisa errada.** O que molda a superfície pública
   — limitação de frequência por rota, sobrescrita do identificador de
   correlação, forma do evento entregue — é produzido pelo API Gateway, não pela
   função. Um invólucro HTTP local escanearia algo que não existe em produção.
4. **O lado consumidor do contrato já é escaneado.** A análise dinâmica da API
   executa uma segunda passagem autenticada como cliente externo, assinando o
   token com par efêmero — exatamente o papel desta função.

## Onde a responsabilidade recai, se for exercida

No repositório do API Gateway, que é dono da superfície pública real.

E lá, como **execução manual contra ambiente descartável** — nunca como portão de
Pull Request, pelo motivo que aquele repositório já registrou: exigiria o
laboratório ligado e escanearia ativamente um ambiente compartilhado.

## O que cobre a superfície no lugar

As propriedades que uma análise dinâmica procuraria nesta superfície permanecem
provadas, cada uma por uma verificação que reprova quando regride:

| Propriedade | Onde é provada |
| --- | --- |
| Indistinguibilidade das quatro recusas | Unitário e ponta a ponta, com comparação byte a byte |
| Ausência de eco do corpo da requisição na resposta e no log | `handler-logging.spec.ts` e ponta a ponta |
| Limite de tamanho do corpo antes da desserialização | `login-event.validator.spec.ts` |
| Ausência de credencial e de dado pessoal em log | Asserção negativa, unitária e de ponta a ponta |
| O caminho publicado responde de fato | Verificação por invocação real e chamada à rota pública, na entrega |

## Alternativas

**Criar o workflow por simetria com a API.** Produziria sinal sobre um invólucro
inexistente, e um relatório verde sobre um alvo fabricado é pior que a ausência
declarada: sugere cobertura que não existe. Rejeitada.

**Escanear a rota pública real a partir deste repositório.** A rota é do API Gateway.
Escaneá-la daqui colocaria o resultado sob o dono errado — quem recebe o
vermelho não é quem consegue consertá-lo — e escanearia ativamente um ambiente
compartilhado. Rejeitada.

## Consequências

**Positivas.** A esteira não carrega um job que mede a coisa errada. A
responsabilidade fica com quem é dono da superfície.

**Negativas.** Assimetria visível em relação à API, que precisa desta explicação
sempre que a comparação for feita — e é para isso que este ADR existe.

## Referências

- [Segurança › Modelo de ameaças](../security.md#modelo-de-ameaças)
- [CI/CD › Análise estática](../ci-cd.md#análise-estática)
- [Testes › Propriedades travadas por teste](../testing.md#propriedades-travadas-por-teste)
