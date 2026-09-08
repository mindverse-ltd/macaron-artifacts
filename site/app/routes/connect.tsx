import type { Route } from './+types/connect';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Open WebUI · Macaron Artifacts' }, { name: 'description', content: 'Open the unified Macaron Artifacts WebUI running locally on your machine.' }];
}

export default function Connect() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="site:p-6 site:flex site:flex-col site:items-center site:justify-center site:flex-1">
        <div className="site:w-full site:max-w-md">
          <h1 className="site:text-xl site:font-bold site:mb-3">Open Macaron Artifacts</h1>
          <p className="site:text-fd-muted-foreground site:text-sm site:leading-relaxed site:mb-6">Start <code>macaron-artifacts</code> on this device, then open its local WebUI. Choose Claude Code, Codex, OpenCode, or pi inside the app.</p>
          <a href="http://127.0.0.1:43860" className="site:inline-flex site:items-center site:justify-center site:gap-2 site:text-sm site:bg-fd-primary site:text-fd-primary-foreground site:rounded-full site:font-medium site:px-4 site:py-2.5 site:focus-visible:outline-none site:focus-visible:ring-2 site:focus-visible:ring-fd-ring">Open local WebUI <ArrowRight aria-hidden="true" className="site:size-4" /></a>
          <p className="site:text-xs site:text-fd-muted-foreground site:mt-3">Default address: <code>http://127.0.0.1:43860</code>. For another port, use the address printed by the launcher.</p>
          <p className="site:text-sm site:mt-6"><Link to="/docs/usage" className="site:underline site:underline-offset-4">Install and configure Macaron Artifacts</Link></p>
          <p className="site:text-xs site:text-fd-muted-foreground site:mt-6">The hosted v0 interface has been retired. Its source remains on the <a href="https://github.com/mindverse-ltd/macaron-artifacts/tree/v0" className="site:underline site:underline-offset-4">v0 branch</a>.</p>
        </div>
      </div>
    </HomeLayout>
  );
}
