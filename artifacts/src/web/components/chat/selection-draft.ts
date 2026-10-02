export const selectionActions = { explain: '解释', modify: '修改', followup: '追问' } as const;
export type SelectionAction = keyof typeof selectionActions;
export function selectionDraft(draft: string, quote: string, action: SelectionAction) {
  const instruction = { explain: '请解释这段内容：', modify: '请修改这段内容：', followup: '关于这段内容：' }[action];
  const suffix = { explain: '', modify: '\n\n修改要求：', followup: '\n\n我的问题：' }[action];
  return `${draft}${draft ? '\n\n' : ''}${instruction}\n\n${quote.trim().split('\n').map(line => `> ${line}`).join('\n')}${suffix}`;
}
