# Name That Tune — phone party prototype

Live multiplayer Name That Tune for phones. Friends join a room, race to name the song that’s playing.

## Play on phones (no install)

**Open on every phone:** https://sfriedman333.github.io/

Backup: https://raw.githack.com/sfriedman333/name-that-tune/main/docs/index.html

Source: https://github.com/sfriedman333/name-that-tune

1. One person taps **Create room** and shares the 4-letter code.
2. Friends **Join** with the code + a name.
3. Host taps **Demo / Manual round**, enters the song title (secretly), everyone races to type it. First correct guess wins; scores stack. Host taps **Next round**.

This phone build is PeerJS P2P (no game server). Great for plane/hotel/bar demos. Live mic ID needs the Node server + AudD token below.

## Full server (Listen / AudD)

```bash
cd /workspace/name-that-tune   # or: git clone https://github.com/sfriedman333/name-that-tune
npm install
# optional: echo 'AUDD_API_TOKEN=...' > .env
npm start   # http://localhost:3847
```

Public HTTPS from a laptop that can tunnel (this box blocks Cloudflare quick tunnels on port 7844):

```bash
./scripts/start-public.sh
# or: cloudflared tunnel --url http://127.0.0.1:3847
```

### AudD live ID

1. Free token: https://dashboard.audd.io/
2. Put `AUDD_API_TOKEN=...` in `.env`
3. Restart. Badge shows **AudD live ID**. Host taps **Listen**.

Without a token, use **Demo** or **Manual reveal** on the Node client at port 3847.

## Known limits

- Live covers / karaoke / heavy remixes often fail music ID — use Manual.
- iPhone Safari mic needs HTTPS + permission (Node Listen mode).
- Node rooms are in-memory (restart clears scores).
- P2P room requires the host’s phone to stay on the page; PeerJS broker must be reachable.
- Box outbound tunnels (cloudflared/localtunnel/ngrok) are blocked here; use a laptop tunnel for AudD Listen with friends off-LAN.
