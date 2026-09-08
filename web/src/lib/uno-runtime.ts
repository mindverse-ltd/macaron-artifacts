import initUnocssRuntime from '@unocss/runtime';
import { unoConfig } from '../../../artifacts/src/web/theme/uno';
import '../genui.css';

// Every legacy entry boots the same reset before its app stylesheet. The runtime
// prepends its ordered style layers, so host CSS keeps its original cascade priority.
// It regenerates theme variables for all observed tokens, including later streamed classes.
void initUnocssRuntime({ defaults: unoConfig() });
