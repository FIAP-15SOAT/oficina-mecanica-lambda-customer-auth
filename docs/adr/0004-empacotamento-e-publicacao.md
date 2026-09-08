# ADR 0004: Empacotamento e publicação da função

## Status

Aceito — 2026-09-08

## Contexto

O [ADR 0003](0003-bcrypt-em-javascript-puro.md) já decidiu **o formato**: um
artefato compactado, não uma imagem de contêiner, porque sem código nativo a
razão mais forte para preferir imagem desaparece.

O que ficou em aberto é o resto do caminho: quem monta o arquivo compactado, o
que vai dentro dele, como uma implantação é identificada depois de publicada, e
como se desfaz uma que deu errado.

Quatro restrições moldam as respostas:

1. **O API Gateway constrói o endereço de invocação sem qualificador.** O `locals.tf`
   do repositório do gateway monta o endereço a partir do nome da função, por
   convenção, sem fonte de dados nem state remoto.
2. **O ambiente de execução fornece uma versão menor específica do cliente do
   gerenciador de segredos**, que varia por versão de runtime e por região, e que
   este repositório não escolhe, não fixa e não reproduz na esteira.
3. **Jobs de esteira não compartilham sistema de arquivos**, e transportar
   artefato entre workflows exige acoplamento por evento de execução ou download
   por identificador.
4. **O código já lê `SERVICE_VERSION`** para o atributo de versão de serviço de
   toda linha de log.

## Decisão

### 1. O arquivo compactado é montado pela ferramenta de infraestrutura

`archive_file` sobre o diretório de saída da construção, no mesmo job que
executa a construção e a aplicação.

Uma única fonte de verdade para o conteúdo e para o identificador de conteúdo. A
fonte de dados normaliza carimbos de tempo, então o identificador deriva do
conteúdo, e um commit inalterado não produz diferença na prévia.

A normalização **não** cobre permissões de arquivo, que entram no arquivo
compactado e diferem entre sistemas operacionais. Daí duas providências: o modo
de arquivo da saída é declarado explicitamente, e fica registrado no guia de
solução de problemas que uma prévia executada numa estação de trabalho de outro
sistema operacional pode acusar diferença de identificador **sem** mudança de
código.

### 2. O cliente do gerenciador de segredos é embutido

Ele deixa de ser dependência de desenvolvimento e passa a ser dependência de
produção. A construção mantém como externo **apenas** o binário opcional do
driver de banco.

Embutir troca uma dependência fora de controle por uma linha no arquivo de
dependências, fixada pelo arquivo de bloqueio como todas as outras. O próprio
fornecedor da plataforma recomenda empacotar os clientes usados, exatamente por
isso.

**Consequência que simplifica a esteira.** A asserção "carregar sem dependências
e afirmar que o único módulo não resolvido é o cliente da nuvem" existia
**apenas** porque o cliente era externo — e era imprecisa, porque os externos
sempre foram dois. Com o cliente embutido, a verificação vira o que deveria ser:
carregar num diretório limpo, fora da árvore do repositório, e afirmar que expõe
a função de tratamento.

O binário opcional do driver continua externo e continua não sendo resolvido no
carregamento, porque o driver só o referencia atrás de um acessor preguiçoso que
esta função nunca toca.

### 3. Versões publicadas, sem apelido

Cada aplicação publica uma versão imutável. Nenhum apelido é adotado.

### 4. Reversão por reconstrução

Reverter o commit e executar a entrega novamente. A construção é determinística
a partir do código-fonte, então o commit revertido produz o artefato anterior.

### 5. Rastreabilidade por identificador de commit

O identificador do commit é injetado como variável de ambiente que o código
**já** lê para o atributo de versão de serviço, e espelhado nas etiquetas do
recurso. Zero mecanismo novo, e toda linha de log passa a responder "qual código
está implantado" sem consultar a nuvem.

## Alternativas

**A validação produz o arquivo compactado e a entrega o consome como artefato.**
Exigiria acoplamento entre workflows por evento de execução ou download por
identificador de execução, e criaria uma segunda fonte de verdade para o
conteúdo. Rejeitada.

**Envio do pacote via armazenamento de objetos.** Necessário apenas acima do
limite de envio direto da plataforma, que este pacote não alcança. Rejeitada por
complexidade sem contrapartida.

**Manter o cliente do gerenciador de segredos externo, com a asserção de
carregamento sem dependências.** Conserva uma dependência que o repositório não
controla e paga uma verificação intrincada para vigiá-la. Rejeitada.

**Importação tardia do cliente.** Adia a falha sem removê-la. Rejeitada.

**Apelido de versão com troca de ponteiro e liberação gradual por peso.** Melhor
reversão — segundos, em vez de uma reconstrução — e liberação progressiva. Exige
mudar `locals.tf` do repositório do gateway e qualificar a autorização de
invocação: uma mudança **entre repositórios** para obter uma reversão que
reverter o commit já entrega, no mesmo modelo das outras quatro stacks.
Rejeitada nesta entrega, com o caminho mapeado.

## Consequências

**Positivas.** Um artefato por aplicação, com identificador derivado do conteúdo:
reaplicar sobre o mesmo commit não indica mudança. Nenhum transporte entre
workflows. A dependência do ambiente de execução que este repositório não
controlava deixou de existir. Toda linha de log carrega o commit implantado.

**Negativas.** O pacote cresce alguns megabytes contra um teto de cinquenta. O
efeito em partida a frio não é demonstrável em nenhuma direção sem medição: o
cliente do ambiente de execução também é lido do disco e interpretado, e **não**
passa por remoção de código morto. Se a medição mostrar perda relevante, a
decisão se reabre com dado, não com estimativa.

Reversão custa uma reconstrução em vez de uma troca de ponteiro. E toda
implantação altera a configuração da função, mesmo sem mudança de código —
irrelevante, porque ela já está publicando uma versão.

## Referências

- [ADR 0003 › Artefato compactado](0003-bcrypt-em-javascript-puro.md)
- [CI/CD › Entrega contínua](../ci-cd.md#entrega-continua)
- [Infraestrutura › O artefato](../terraform.md#o-artefato)
