import { until } from './dev-fixture.mjs';

// Forward Vite's actual buffered startup reload; never invent a checkpoint.
export async function openFirstRecordingPage(page, url) {
  let releaseStartupReload;
  await page.routeWebSocket('**/*', socket => {
    const upstream = socket.connectToServer();
    upstream.onMessage(message => {
      if (!releaseStartupReload && JSON.parse(String(message)).type === 'full-reload') releaseStartupReload = () => socket.send(message);
      else socket.send(message);
    });
  });
  await page.goto(url);
  await until(() => releaseStartupReload);
  const reloaded = page.waitForEvent('load');
  releaseStartupReload();
  await reloaded;
}
