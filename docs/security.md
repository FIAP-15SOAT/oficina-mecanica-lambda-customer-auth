# Segurança

Esta função é o **endpoint de login público** do fluxo externo. Ela é anônima
por definição, alcançável pela internet e o único ponto do sistema em que uma
credencial de cliente trafega.

## Modelo de ameaças

### Sem credencial de banco

A função não acessa banco de dados e não recebe credencial, endereço ou regra de
rede de banco algum. A senha do cliente é verificada pelo **Identity**, o serviço
que guarda os usuários e as senhas: a função a repassa, junto com o CPF, no corpo
de `POST /internal/customer-authentications`, e nunca vê o hash. Os vínculos
entre usuário e cliente são conferidos no **work-order**, o serviço das ordens de
serviço. A decisão está no
[ADR 0007](adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md).

### As chamadas internas

As duas chamadas usam HTTP sem TLS até o NLB (Network Load Balancer), o
balanceador de rede **interno** do cluster Kubernetes onde os serviços rodam: ele
só aceita tráfego de dentro da VPC, e a função executa nas subnets privadas. As
chamadas não levam credencial de serviço: as rotas `/internal/...` não são
publicadas pelo API Gateway, e a proteção delas é a fronteira de rede. Autenticar
as chamadas internas entre serviços é uma decisão adiada da solução, que vale
para todos os serviços, não só para esta função.

### Superfícies do login

| Ameaça | Superfície | Mitigação |
| --- | --- | --- |
| Enumeração de contas | Resposta de erro do login | Mensagem, status e corpo **idênticos** nas quatro causas de recusa |
| Enumeração por temporização | Diferença de tempo entre as causas | **Não mitigada** — risco aceito; ver abaixo |
| Força bruta por conta | Repetição contra um CPF | **Não mitigada** — ver abaixo |
| Vazamento de credencial em log | — | O corpo da requisição **nunca** é registrado; asserção negativa unitária e de ponta a ponta |
| Vazamento de dado pessoal em log | CPF na requisição | Mascarado preservando a forma (`***.***.789-09`), pela classificação do registro |
| Vazamento de detalhe interno | Corpo das respostas `500`/`503` | Mensagem constante; nada da exceção — URL interna, status devolvido pelo serviço — é repassado |
| Vazamento da senha numa chamada interna que falha | O erro do cliente HTTP guarda o corpo enviado ao Identity | O log registra tipo, mensagem saneada e as pilhas da cadeia de causas, nunca o corpo nem a configuração da requisição; asserção de ponta a ponta com o Identity estourando o tempo, respondendo 5xx e respondendo redirect |
| Resposta inesperada lida como recusa | Resposta do Identity fora do contrato | Só o `401` do Identity é recusa; qualquer outro 4xx, 5xx, redirect ou sucesso sem o `userId` responde `503`, nunca `401` |
| Token emitido sem o vínculo conferido | Resposta do work-order fora do contrato | Sucesso sem a lista de clientes responde `503`; o token só sai com a lista conferida e não vazia |
| Confusão de algoritmo no token | Verificação no work-order | `RS256` assimétrico, verificado por estratégia separada da interna; o token externo nunca alcança o verificador HMAC |
| Escalonamento por claim forjada | Conteúdo do token | Além de `iss`, `aud`, `iat` e `exp`, o token carrega `sub` como identidade; papel e escopo nunca vêm dele |
| Corpo hostil como negação de serviço | Corpo da requisição | Limite de 4096 bytes depois da decodificação base64 e antes da desserialização JSON |
| Sobrecarga do Identity | Concorrência de logins | Cada login custa ao Identity uma verificação de hash de senha, que consome CPU; a concorrência reservada da função, padrão 10, limita quantas acontecem ao mesmo tempo |
| Análise dinâmica ausente | Superfície pública | A função não expõe superfície HTTP própria; a decisão e o que cobre a superfície no lugar estão no [ADR 0006](adr/0006-sem-analise-dinamica.md) |

## Anti-enumeração

As quatro causas de recusa — CPF inexistente, conta inativa, senha incorreta e
ausência de vínculo com cliente ativo — produzem **exatamente** a mesma resposta:
`401`, mesmo corpo, mesma mensagem. A causa específica existe apenas no log.

O Identity responde o mesmo `401` para CPF inexistente, conta inativa e senha
incorreta, e registra a causa no próprio log. Esta função recusa em duas etapas
— `credential_refused` quando o Identity recusa, `no_active_customer_link` quando
o work-order não devolve cliente ativo — e as duas produzem a mesma exceção.

Nada na resposta permite descobrir se um CPF existe no sistema. Um teste
unitário afirma que as duas etapas produzem exceções indistinguíveis; um teste de
ponta a ponta compara as respostas de "CPF inexistente", "senha incorreta" e "sem
cliente ativo" e afirma que são byte a byte iguais.

## Enumeração por temporização — risco aceito

A mensagem única fecha metade do problema. A outra metade é o **tempo**.

A verificação de senha, feita pelo Identity, custa centenas de milissegundos; as
recusas por CPF inexistente e por conta inativa retornam antes dela. A ausência
de vínculo ativo só é avaliada depois de a senha conferir, e custa ainda a
chamada ao work-order. **Essa diferença é observável**, e permite inferir se um
CPF está cadastrado mesmo com as quatro respostas idênticas.

**A decisão é conviver com isso.** A ordem de avaliação é a do Identity, dono da
credencial, e o login interno dos funcionários tem a mesma diferença. A resposta
idêntica fecha a enumeração pelo conteúdo; o tempo é um canal lateral de baixa
severidade.

**O que reduz o risco na prática:** a limitação de frequência por rota no
gateway encarece a varredura em volume. **O que não reduz:** nada impede a
medição pontual de um CPF específico.

**Gatilho para revisitar:** se a enumeração de CPFs cadastrados passar a ser
tratada como risco relevante, a mudança é no Identity, que faz a verificação.

## Custódia da chave

| | |
| --- | --- |
| Algoritmo | `RS256` |
| Chave privada | somente a função, obtida do gerenciador de segredos na inicialização |
| Chave pública | distribuída ao work-order |
| Independência | separada de qualquer segredo da autenticação interna |
| Identificador | `kid` no cabeçalho desde a primeira versão |

O PEM é importado **na inicialização do ambiente**, e não na primeira assinatura:
um PEM inválido falha na composição, registrando `app.configuration.invalid` em
nível de erro, e o diagnóstico aponta para a implantação em vez do runtime.

O ambiente, porém, **não é abortado** — erro de plataforma não está no contrato
de erros da função. Enquanto o PEM estiver inválido, toda invocação responde
`500` no envelope documentado e reemite o evento, porque a composição falha não é
memoizada. É esse o sinal a monitorar, e não a ausência de ambientes saudáveis.

`CUSTOMER_JWT_PRIVATE_KEY_SECRET_ID` aponta para um segredo cujo valor é o **PEM
PKCS#8 puro** — não um JSON que o embrulhe —, com quebras de linha **reais**. A
restauração de `\n` escapado existe apenas no caminho da variável de ambiente,
que é a forma adotada pelos exemplos deste repositório para `.env`; o valor vindo do gerenciador de
segredos é usado como está, e um PEM guardado ali com `\n` literais falha a
composição.

**Nenhum par de chaves é versionado neste repositório.** O emissor e a suíte de
ponta a ponta geram um par RSA **em tempo de teste** e verificam com a chave
pública correspondente, o que remove custódia de material sensível do
repositório. A regra de exclusão do controle de versão cobre `*.pem` nas duas
metades, e o repositório é público — o que torna a regra uma fronteira, não uma
conveniência.

### A cadeia de custódia da metade privada

| Etapa | Onde | Quem lê |
| --- | --- | --- |
| 1 | Cofre de segredos do **environment** `production` | Apenas um job que declara aquele environment e satisfaz as suas regras |
| 2 | Variável mascarada da execução da entrega | O job, durante a execução |
| 3 | Gerenciador de segredos da nuvem, cifrado pela chave gerenciada padrão | A role de execução da função |
| 4 | Memória do ambiente de execução, importada na partida a frio | A função |

O cofre do provedor **não faz parte do repositório**: a regra de exclusão do
controle de versão é irrelevante para ele. O material é carregado uma única vez,
a partir do arquivo local.

O segredo vive no **environment**, e não no cofre do repositório. A distinção é a
fronteira: segredo de repositório é legível por **qualquer** workflow, inclusive
os disparados por `push` em branch de trabalho — o que, num repositório público,
significa legível por quem tiver permissão de escrita.

**O valor nunca transita pelo state da infraestrutura.** A stack declara o
contêiner do segredo e não o seu valor; a entrega grava o valor de forma
idempotente. Declará-lo na infraestrutura o colocaria em texto puro num bucket
compartilhado pelas stacks Terraform da solução.

A metade pública correspondente é configurada no ambiente do work-order e no
seu Secret Kubernetes pelo CD dele; ela não precisa ser versionada para verificar
o token. As duas metades são do mesmo par, gerado uma única vez fora
de qualquer repositório.

Nenhum segredo real é versionado em nenhum arquivo: `app/.env.example` contém
apenas valores de exemplo, e `.env` é ignorado pelo controle de versão.

## Redação de dados no log

Nunca, em nenhum campo: senha em texto puro, hash de senha, chave privada, token
emitido ou cabeçalho de autorização.

A classificação acontece **pelo nome do campo**, sem exigir mascaramento
explícito no ponto de chamada — é o que impede que um ponto novo esqueça de
mascarar. Segredo é **removido**; dado pessoal é **mascarado preservando a
forma**.

O corpo da requisição **nunca** é registrado, em nenhum status. Classificar por
nome de campo protege os nomes previstos, mas o corpo é controlado pelo cliente:
uma credencial repetida sob uma chave semanticamente neutra atravessaria a
classificação inteira. O diagnóstico de uma recusa já é coberto pela causa
nomeada, pelo status e pelo CPF mascarado — não sobra informação operacional que
justifique capturar o payload.

O saneamento de texto livre — mensagem de exceção e pilha — usa o **mesmo**
conjunto de padrões de segredo dos serviços (`password`, `pwd`, `secret`, `api_key`
como par chave=valor, além de JWT, esquema de autenticação e credencial embutida
em URL). Não há divergência de classificação entre a função e os serviços.

Detalhes em [Logging](logging.md).

## Limitação de frequência: o que existe e o que não existe

**A limitação por rota do gateway não é proteção contra força bruta por conta.**

A distinção importa e é fácil de confundir:

| Mecanismo | Do que protege | Do que **não** protege |
| --- | --- | --- |
| Limitação de frequência da rota, no gateway | Sobrecarga do serviço; um cliente sozinho saturando a função e o Identity | Tentativas repetidas contra **uma** conta, distribuídas abaixo do limite ou entre origens |
| Bloqueio com estado por conta | Força bruta por conta | — (não existe) |
| Regra por origem em firewall de aplicação | Força bruta de uma origem | — (não existe) |

Hoje **não há** bloqueio de conta por tentativas, nem contador com estado, nem
regra por origem. Um atacante que conheça um CPF pode tentar senhas no limite que
o gateway permitir, indefinidamente. O risco foi aceito no desenho da
autenticação externa e é herdado aqui.

Mitigá-lo de verdade exigiria estado compartilhado entre invocações — a função é
sem estado por construção —, ou seja, um contador externo ou uma regra no
firewall de aplicação. Nenhuma das duas existe, e esta seção existe para que a
limitação do gateway não seja lida como se já a resolvesse.

**A concorrência reservada não é anti-força-bruta.** Ela limita a carga de
verificações de senha no Identity, que é a linha correspondente da tabela de
ameaças — não esta.

## Superfície de dependências

Quatro dependências de runtime próprias: cliente HTTP (`axios`), biblioteca de
assinatura (`jose`), logger (`pino`) e validador de esquema (`zod`). Nenhuma é
módulo nativo, e a biblioteca de assinatura tem **zero** dependências
transitivas — numa função de segurança sujeita a varredura, é redução mensurável
de superfície.

Nenhuma biblioteca de fornecedor de observabilidade está presente: a saída é
stdout, e a coleta é responsabilidade da infraestrutura — uma camada anexada à
função, configurada por variáveis de ambiente, sem uma linha em `src/`. Ver
[ADR 0005](adr/0005-coleta-de-telemetria-sem-instrumentacao.md).

O cliente do gerenciador de segredos (`@aws-sdk/client-secrets-manager`) é a
quinta dependência de runtime, embutida
no pacote em vez de consumida do ambiente de execução — a razão está no
[ADR 0004](adr/0004-empacotamento-e-publicacao.md). Ela é fixada pelo arquivo de
bloqueio como todas as outras, e por isso **entra na varredura**, o que a versão
fornecida pelo ambiente não fazia.

## A credencial do destino de telemetria é legível na configuração

Ela vai como variável de ambiente da função, e portanto é legível por quem puder
ler a configuração da função.

É paridade deliberada com os serviços, onde a mesma credencial é um Secret do cluster —
codificado, legível por quem tiver permissão de leitura no espaço de nomes. Numa
conta de laboratório com role ampla, a diferença é nominal.

**O fornecedor recomenda outra coisa:** guardá-la no gerenciador de segredos e
referenciá-la por identificador. Isso acrescentaria um recurso e uma leitura por
partida a frio para uma diferença que este ambiente não realiza. Registrado aqui
para que a divergência da recomendação seja escolha, e não descuido.

## Repositório público

O repositório é público, e três consequências são assumidas explicitamente:

1. **Nenhum material sensível é versionado.** Chaves, `.env` e `terraform.tfvars`
   estão fora do controle de versão, e o material da chave privada não passa pelo state. A chave de
   telemetria é sensível no Terraform, mas integra o environment da função
   e permanece no state; `sensitive` não a remove desse arquivo.
2. **A prévia de infraestrutura na validação usa credencial da nuvem** num
   workflow disparado por `push` em branch de trabalho, e a sua saída vai para um
   log público. Aceito, com os atenuantes registrados em
   [CI/CD › Exposição aceita conscientemente](ci-cd.md#exposição-aceita-conscientemente).
   O que um workflow de branch alcança é a credencial do laboratório, e **nada**
   do material próprio desta função.
3. **Pedido de merge vindo de bifurcação não recebe segredo**, por política do
   provedor.
