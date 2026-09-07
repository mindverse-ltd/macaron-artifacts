// Host-owned tokens for the published GenUI components and their generated code.
import type { Rule, UserShortcuts } from "@unocss/core";
import type { Theme } from "@unocss/preset-wind4";

const hsl = (name: string) => `hsl(var(--macaron-${name}))`;
const withForeground = (name: string) => ({ DEFAULT: hsl(name), foreground: hsl(`${name}-foreground`) });

export const unoTheme: Theme = {
  colors: {
    border: hsl("border"),
    input: hsl("input"),
    ring: hsl("ring"),
    background: hsl("background"),
    foreground: hsl("foreground"),
    primary: withForeground("primary"),
    secondary: withForeground("secondary"),
    destructive: withForeground("destructive"),
    muted: withForeground("muted"),
    accent: withForeground("accent"),
    popover: withForeground("popover"),
    card: withForeground("card"),
  },
  radius: { lg: "var(--macaron-radius)", md: "calc(var(--macaron-radius) - 2px)", sm: "calc(var(--macaron-radius) - 4px)" },
  font: {
    sans: 'var(--macaron-font-sans)',
    mono: 'var(--macaron-font-mono)',
  },
  // Wind4 retains UnoCSS's animation shape rather than Tailwind's animation/keyframes split.
  animation: {
    keyframes: {
      "accordion-down": "{from{height:0}to{height:var(--radix-accordion-content-height)}}",
      "accordion-up": "{from{height:var(--radix-accordion-content-height)}to{height:0}}",
    },
    durations: { "accordion-down": "0.2s", "accordion-up": "0.2s" },
    timingFns: { "accordion-down": "ease-out", "accordion-up": "ease-out" },
  },
};

export const unoShortcuts: UserShortcuts<Theme> = {
  "bg-macaron-gradient": "bg-[linear-gradient(97.87deg,#FFC400_0.21%,#FF5A70_50.21%,#F63B3B_100.21%)]",
  "bg-macaron-gradient-new": "bg-[linear-gradient(98deg,#FFC300_0.21%,#FF5A70_50.21%,#F63B3B_100.21%)]",
};

export const unoRules: Rule<Theme>[] = [[/^transition-\[padding-left\]$/, () => ({ "transition-property": "padding-left" })]];
