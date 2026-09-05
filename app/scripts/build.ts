import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';

const ALIASES = ['@domain/', '@application/', '@infrastructure/', '@interface-adapters/'];

/**
 * `@aws-sdk/*` fica externo porque o runtime já o fornece — embuti-lo
 * multiplicaria o tamanho do pacote por uma única chamada.
 * `pg-native` fica *externo* por necessidade: o driver o referencia atrás de
 * um getter opcional que esta função nunca toca, e sem marcá-lo o esbuild
 * falha ao resolver.
 */
async function buildArtifact(): Promise<void> {
  await rm('dist', { recursive: true, force: true });

  await build({
    entryPoints: ['src/handler.ts'],
    outfile: 'dist/handler.js',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    sourcemap: true,
    sourcesContent: false,
    treeShaking: true,
    legalComments: 'none',
    external: ['@aws-sdk/*', 'pg-native'],
    tsconfig: 'tsconfig.json',
    logLevel: 'info',
  });

  // Os aliases são resolvidos em tempo de build. Um que sobreviva no pacote só
  // falharia na primeira invocação publicada, então o build falha aqui.
  const bundle = await readFile('dist/handler.js', 'utf8');
  const unresolved = ALIASES.filter((alias) => bundle.includes(alias));

  if (unresolved.length > 0) {
    throw new Error(`Aliases não resolvidos no pacote: ${unresolved.join(', ')}`);
  }
}

buildArtifact().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
