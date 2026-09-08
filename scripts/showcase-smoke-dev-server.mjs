import { resolve } from 'node:path'

/** Keep development React diagnostics without binding either user's port 3100. */
export function isolatedShowcaseDevConfig(config, root) {
  return {
    ...config,
    configFile: false,
    root,
    plugins: (config.plugins ?? []).filter((plugin) => plugin?.name !== 'injoffice-ipv6-loopback'),
    server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: false, open: false },
  }
}

export async function startShowcaseDevServer(root) {
  const { createServer, loadConfigFromFile } = await import('vite')
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, resolve(root, 'vite.config.ts'))
  if (!loaded) throw new Error('The playground Vite configuration could not be loaded.')
  const server = await createServer(isolatedShowcaseDevConfig(loaded.config, root))
  try {
    await server.listen()
    return {
      url: `http://127.0.0.1:${server.httpServer.address().port}/`,
      close: () => server.close(),
    }
  } catch (error) {
    await server.close()
    throw error
  }
}
