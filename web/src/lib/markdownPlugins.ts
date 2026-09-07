import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough/parseOnly';
import remarkGfm from 'remark-gfm';

// The strikethrough patch rewrites remark-gfm's own tokenizer, so it must stay after it.
export const markdownRemarkPlugins = [remarkCjkFriendly, remarkGfm, remarkCjkFriendlyGfmStrikethrough];
