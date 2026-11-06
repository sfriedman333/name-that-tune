# Name That Tune — phone party prototype

Live multiplayer Name That Tune for phones. Friends join a room, race to name the song that’s playing.

## Play on phones (no install)

**Static P2P demo (works now):** open the GitHub Pages / jsDelivr URL for `docs/index.html` on every phone.

1. One person taps **Create room** and shares the 4-letter code.
2. Friends **Join** with the code + a name.
3. Host taps **Demo / Manual round**, enters the song title (secretly), everyone races to type it. First correct guess wins; scores stack. Host taps **Next round**.

This P2P build uses PeerJS (no game server). Great for plane/hotel/bar demos. Live mic ID needs the Node server + AudD token below.

## Full server (Listen / AudD)

```bash
cd name-that-tune
npm install
# optional: echo 'AUDD_API_TOKEN=...' > .env
npm start   # http://localhost:3847
```

Public HTTPS from a laptop that can tunnel:

```bash
./scripts/start-public.sh
# or: cloudflared tunnel --url http://127.0.0.1:3847
```

### AudD live ID

1. Free token: https://dashboard.audd.io/
2. Put `AUDD_API_TOKEN=...` in `.env`
3. Restart. Badge shows **AudD live ID**. Host taps **Listen**.

Without a token, use **Demo** or **Manual reveal**.

## Known limits

- Live covers / karaoke / heavy remixes often fail music ID — use Manual.
- iPhone Safari mic needs HTTPS + permission.
- Node rooms are in-memory (restart clears scores).
- P2P room requires the host’s phone to stay on the page; PeerJS broker must be reachable.
- Box network may block outbound tunnels (cloudflared port 7844); run the tunnel on a normal laptop if needed.
