const METADATA_PREFIX = 'macaron-metadata:';
export default {
  id: 'macaron-artifacts-metadata-gate',
  name: 'Macaron Artifacts Metadata Gate',
  description: 'Blocks tool execution in Macaron metadata forks.',
  register(api) {
    api.registerTrustedToolPolicy({
      id: 'macaron-metadata-gate',
      description: 'Deny every tool call in Macaron metadata fork sessions.',
      evaluate(_event, ctx) {
        return typeof ctx.sessionKey === 'string' && ctx.sessionKey.startsWith(METADATA_PREFIX)
          ? { block: true, blockReason: 'Macaron metadata fork is non-executing.' }
          : undefined;
      },
    });
  },
};
