# ADR 0003: bcrypt em JavaScript puro, artefato compactado e emulação local

## Status

Aceito — 2026-08-31

## Contexto

A API grava senhas com `bcrypt`, que é **módulo nativo**. Um módulo nativo não
executa na plataforma serverless sem uma camada dedicada ou sem ser compilado na
arquitetura exata do runtime.

Essa única restrição decide três coisas que parecem independentes: qual
biblioteca de hash usar, em que formato publicar a função, e como executá-la
localmente. Elas estão neste ADR porque são a mesma decisão.

## Decisão

### 1. bcrypt em JavaScript puro

Usar a implementação em JavaScript puro, que verifica **os mesmos hashes**
`$2a$`/`$2b$` que o módulo nativo da API gera. Um teste consome hashes produzidos
pela biblioteca nativa da API e afirma que eles são aceitos aqui.

A objeção habitual é que bcrypt em JavaScript puro bloqueia o laço de eventos por
centenas de milissegundos, travando as demais requisições do processo. **Aqui
essa objeção não existe**: cada ambiente de execução atende uma invocação por
vez, e não há outra requisição para travar. A desvantagem principal desaparece
por construção neste ambiente.

O custo real é latência. A verificação passa a ser o termo dominante do tempo de
resposta — medida em ~270 ms com fator de custo 12, provavelmente mais que banco,
rede e assinatura somados. Isso não a torna inaceitável, mas torna a **memória
alocada o único ajuste que importa**, já que a CPU da plataforma escala com ela.
Daí a exigência de instrumentar a duração da verificação como campo de log
próprio.

### 2. Artefato compactado, não imagem de contêiner

Consequência direta da primeira decisão: **sem código nativo, a razão mais forte
para preferir imagem de contêiner desaparece.**

Um artefato compactado torna a infraestrutura trivial, dispensa registro de
imagens próprio para esta função, dispensa construção e publicação de imagem na
esteira, e produz um arquivo de poucas centenas de kilobytes.

A imagem de contêiner ofereceria um artefato local idêntico ao publicado. Sem
módulo nativo, essa diferença deixa de ter conteúdo prático: o mesmo pacote
executa igual dentro e fora do contêiner.

### 3. Execução local por invocação avulsa, sem framework de implantação

O modo de desenvolvimento é `npm run invoke`: o ponto de entrada executado uma
vez com um evento versionado no formato do gateway. É o ciclo de um
`sam local invoke -e evento.json`, sem o descritor de funções que viraria uma
segunda fonte de verdade competindo com o Terraform.

*Alternativas:* um framework de implantação com modo offline não compra
fidelidade — ele roda o ponto de entrada no interpretador local, exatamente como
o comando acima — e cobra um descritor. Emulação completa de serviços de nuvem
faria sentido com várias integrações; aqui há uma, resolvida por variável de
ambiente em desenvolvimento. Um contêiner com o emulador de runtime compra
fidelidade real, mas o que ele provaria — que o `.zip` sobe e responde — é
verificação de esteira, e pertence à change de infraestrutura. Rejeitadas.

## Alternativas consideradas

**Módulo nativo com camada dedicada.** Amarra o formato do artefato e reintroduz
uma diferença entre o que se testa e o que se publica. Rejeitada.

**Módulo nativo compilado na imagem base do runtime.** Força a imagem de
contêiner e a esteira de imagens. Rejeitada — mas volta à mesa se o módulo nativo
for reintroduzido: as duas decisões são a mesma.

**Imagem de contêiner como formato de publicação.** Sem código nativo, paga
registro, construção e publicação de imagem por uma equivalência que já existe.
Rejeitada.

**Framework de implantação com modo offline.** Não executa no runtime da
plataforma; a fidelidade que aparenta comprar não é real. Rejeitada.

**Ferramenta oficial de emulação local com descritor próprio.** Executa em
contêiner e a fidelidade é real, mas cobra um descritor que duplica a
infraestrutura e é lenta por invocação. O que ela provaria pertence à esteira.
Rejeitada.

**Emulação completa de serviços de nuvem.** Faria sentido com várias
integrações; aqui há uma, resolvível por variável de ambiente em
desenvolvimento. Rejeitada.

## Consequências

**Positivas.** O artefato é portátil e sem código nativo: o que roda na máquina
de quem desenvolve é equivalente ao que roda publicado. A infraestrutura fica
trivial e o pacote pequeno. O ciclo de desenvolvimento é curto, sem Docker no
caminho diário.

**Negativas.** A latência é dominada pela verificação de senha, e o
dimensionamento de memória passa a ser a alavanca principal — por isso as três
durações são instrumentadas separadamente desde o primeiro dia, para que o
dimensionamento seja medição e não adivinhação.

O modo de desenvolvimento diário não é fiel ao runtime: ele roda no interpretador
local. A mitigação pertence à esteira: a primeira publicação exercita o artefato
no runtime real.

**Nota sobre a biblioteca de assinatura.** A versão adotada é a que publica
build CommonJS. O artefato é um pacote único em CommonJS, e a suíte de testes
exercita o mesmo sistema de módulos que a produção — dev e publicação passam pelo
mesmo caminho de carregamento, que é a mesma propriedade que este ADR persegue
para o hash.

## Referências

- [Segurança › Enumeração por temporização](../security.md#enumeração-por-temporização--risco-aceito)
- [Logging › As três durações](../logging.md#as-três-durações)
- [Como executar localmente](../local-setup.md)
