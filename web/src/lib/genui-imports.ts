import { createImportMapResolver, esmShFallback, literalImportMap, prepareRendererImportMap } from 'partial-react/import-map';
import { createTsxCompiler } from 'partial-react/compiler';
import { assetUrl } from './assetBase';

const shims = { react: 'react', 'react/jsx-runtime': 'react-jsx-runtime', 'react/jsx-dev-runtime': 'react-jsx-dev-runtime', 'react-dom': 'react-dom', '$macaron/ui': 'ui', '$macaron/ui/charts': 'charts', 'lucide-react': 'lucide', 'framer-motion': 'motion', motion: 'motion', 'motion/react': 'motion', '$macaron/chat': 'chat' };
const baseImports = () => Object.fromEntries(Object.entries(shims).map(([name, file]) => [name, new URL(`${assetUrl('')}/genui-shim/${file}.mjs`, location.origin).href]));

export function createGenuiImports() {
  const imports = baseImports();
  // esm.sh externalizes React. Its native imports must use the same instance as
  // the host and partial-react, even though generated TSX uses a per-renderer map.
  if (!document.querySelector('script[type="importmap"]')) {
    const element = document.createElement('script'); element.type = 'importmap'; element.textContent = JSON.stringify({ imports }); document.head.prepend(element);
  }
  const resolver = createImportMapResolver([literalImportMap({ imports }), esmShFallback()]);
  return async ({ source }: { source: string }) => ({ importMap: prepareRendererImportMap(await resolver.resolve({ code: source })), rewrite: (code: string) => code });
}

let warmup: Promise<unknown> | undefined;
export const preloadRendererRuntime = () => (warmup ??= createTsxCompiler().compile('export default function App(){return null}').catch(error => { warmup = undefined; throw error; }));
