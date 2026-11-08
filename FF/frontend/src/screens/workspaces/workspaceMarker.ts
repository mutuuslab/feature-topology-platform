import type { Workspace } from '@ff/contracts';
import { OIDC_AUTH } from '../../auth-mode';

/** Shared business homes are available to a verified SSO team. Demo selectors stay outside production. */
export function workspaceMarker(workspace: Workspace) {
  if (OIDC_AUTH) return { 'data-team-home': workspace };
  return { 'data-workspace-home': workspace };
}
