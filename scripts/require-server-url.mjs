// Runs before the website build on Vercel. The website there is static, and the game server (Socket.IO)
// runs elsewhere, so the build must know the server's address. Without it the site would load but never connect.
if (process.env.VERCEL && !process.env.VITE_SERVER_URL) {
  console.error('\nBuild stopped: VITE_SERVER_URL is not set.');
  console.error('Set it in Vercel (Project Settings > Environment Variables) to the address of your game server,');
  console.error('for example https://gametribe-live.onrender.com, then redeploy.\n');
  process.exit(1);
}
if (process.env.VERCEL && !/^https:\/\//.test(process.env.VITE_SERVER_URL)) {
  console.error('\nBuild stopped: VITE_SERVER_URL must start with https:// (browsers block insecure connections from an https site).\n');
  process.exit(1);
}
if (process.env.VERCEL && /\.(vercel|netlify)\.app$/.test(new URL(process.env.VITE_SERVER_URL).hostname) && !process.env.ALLOW_SERVERLESS_SERVER) {
  console.error('\nBuild stopped: VITE_SERVER_URL points at a serverless host (' + new URL(process.env.VITE_SERVER_URL).hostname + ').');
  console.error('The game server needs one always-on process (Render, Fly.io, Railway or a VPS). On a serverless host, players get "PIN not found" and connections drop.');
  console.error('If you are sure, set ALLOW_SERVERLESS_SERVER=1 to build anyway.\n');
  process.exit(1);
}
