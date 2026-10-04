// Fixed harmless attachment controls. No transform qualification or product API.
import path from 'node:path';

const refused = code => Object.assign(new Error(code), { code });

export function controlFixtureCode(root, mode, file, code) {
  if (file === path.join(root, 'entry.mjs') && mode === 'refuse') throw refused('EVALUATED_INPUT_REFUSED');
  if (file === path.join(root, 'helper.mjs') && mode === 'mutate') {
    if (!code?.includes('const scalar = 3')) throw refused('ATTACHMENT_CONTROL_MISSING');
    return code.replace('const scalar = 3', 'const scalar = 4');
  }
  return code;
}

export function attachFixtureClientControls(server, root, mode) {
  const client = server.environments.client;
  if (!client || typeof client.transformRequest !== 'function') throw refused('ATTACHMENT_CONTEXT_REFUSED');
  const original = client.transformRequest.bind(client);
  client.transformRequest = async (url, options) => {
    const result = await original(url, options);
    const module = await client.moduleGraph.getModuleByUrl(url);
    const code = controlFixtureCode(root, mode, module?.file, result?.code);
    return code === result?.code ? result : { ...result, code };
  };
}
