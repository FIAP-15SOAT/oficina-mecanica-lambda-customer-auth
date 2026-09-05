# ADR 0002: Camadas enxutas com composição memoizada

## Status

Aceito — 2026-08-31

## Contexto

A API principal mantém Clean Architecture com **dois** anéis de adaptadores: um
livre de framework e outro que é a borda do framework, com módulos, provedores e
injeção por contêiner. Esse é o patamar de qualidade esperado aqui.

Mas parte daquela estrutura existe **por causa do framework**. Nesta função não
há framework: há um ponto de entrada que recebe um objeto e devolve outro.
Reproduzir a estrutura inteira seria copiar a forma sem a causa.

Ao mesmo tempo, o ambiente impõe uma restrição que a API não tem: ele **congela**
assim que a resposta retorna e reaproveita o mesmo processo nas invocações
seguintes. Há três inicializações caras — dois segredos, a conexão que depende de
um deles, e a chave de assinatura preparada a partir do outro — que precisam
ocorrer **uma vez por ambiente**, não uma vez por invocação. Pagá-las a cada
invocação transformaria cada login em três idas de rede desnecessárias.

## Decisão

**Quatro camadas, um anel de adaptadores, composição memoizada em um arquivo.**

O único anel de adaptadores de interface — controlador e apresentador, livres de
framework — cumpre o papel dos dois da API. A tradução do formato de evento e de
resposta da plataforma fica confinada a um módulo de infraestrutura
(`infrastructure/serverless/`), e uma regra de lint garante que nenhum outro
arquivo importe os tipos da plataforma.

A composição vive em `src/bootstrap.ts`, memoizada:

```ts
let cached: Promise<Dependencies> | undefined;

export function getDependencies(): Promise<Dependencies> {
  cached ??= build().catch((error: unknown) => {
    cached = undefined;   // falha transitória não condena o ambiente
    throw error;
  });

  return cached;
}
```

**Isto não é injeção de dependência**, e nenhum contêiner reflexivo é adotado:
são poucas linhas de fiação para quatro objetos. É uma exigência do ambiente,
não uma escolha de estilo.

Os dois segredos são obtidos **em paralelo**, economizando uma ida de rede no
caminho frio. A configuração é validada antes de tudo, e o PEM é importado aqui:
uma variável ausente e uma chave ilegível falham **na composição**, que começa no
Init, e não no meio do atendimento de um usuário real.

**A falha de composição não aborta o ambiente**, e isso é deliberado: o contrato
de erro da função não comporta erro de plataforma, então a invocação aguarda a
composição e responde `500` com o corpo previsto. Ela também **não é memoizada**
— como mostra o `cached = undefined` acima —, de modo que cada invocação seguinte
tenta compor de novo. Uma configuração permanentemente inválida não deixa o
ambiente sem subir: deixa toda invocação em `500`, reemitindo
`app.configuration.invalid`.

O ponto de entrada fica fino: obtém as dependências já inicializadas, delega e
responde.

## Alternativas consideradas

**Reproduzir os dois anéis da API.** Copiaria a forma sem a causa: o segundo anel
existe para servir o framework, que aqui não existe. Rejeitada.

**Adotar um contêiner de injeção de dependência.** Para quatro objetos, o
contêiner é mais código de configuração do que o código que ele configura, e
acrescenta reflexão e metadados a um artefato em que tamanho é tempo de
inicialização. Rejeitada.

**Três caches independentes, um por módulo.** Cada módulo memoizaria a própria
inicialização. Triplica o que o teste precisa reiniciar entre casos, espalha a
ordem de dependência entre arquivos, e torna a obtenção em paralelo dos segredos
impossível de expressar. Rejeitada.

**Fiação no ponto de entrada.** Engorda justamente o que se quer fino, e mistura
inicialização com atendimento no mesmo arquivo. Rejeitada.

## Consequências

**Positivas.** A regra é testável sem infraestrutura: a suíte unitária instancia
o caso de uso com implementações de teste das quatro portas. A inicialização cara
acontece uma vez por ambiente, e há teste afirmando isso. Trocar o formato de
evento do gateway alcança um diretório.

**Negativas.** `bootstrap.ts` é estado de módulo — um cache global. Ele é
excluído da métrica de cobertura, por ser fiação sem ramificação de negócio, mas
**tem spec própria** cobrindo memoização, obtenção em paralelo e o
comportamento de falha. A exclusão é da métrica, não do teste.

Um teste que precise de composição nova tem de chamar `resetDependencies()` —
uma função que existe para o teste e não para o runtime, o que é uma concessão
consciente.

## Referências

- [Arquitetura](../architecture.md)
- [Testes › Cobertura](../testing.md#cobertura)
