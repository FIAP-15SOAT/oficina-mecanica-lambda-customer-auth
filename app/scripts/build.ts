import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';

const ALIASES = ['@domain/', '@application/', '@infrastructure/', '@interface-adapters/'];

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
