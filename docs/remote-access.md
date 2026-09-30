# From your LAN to public HTTPS

Start by getting SelfCloud working locally and making a backup. A **domain** is
the name you buy; **DNS** tells browsers where it lives; **HTTPS** encrypts the
connection. Cloudflare can provide DNS, a proxy, or a tunnel. These are different
services, and owning a domain alone does not publish your server.

## Option A: Cloudflare Tunnel

A tunnel connector (`cloudflared`) running on your server connects outbound to
Cloudflare. This generally avoids router port forwarding and works behind CGNAT.

1. Register a domain and add it to your Cloudflare account, following its DNS
   nameserver instructions.
2. In Cloudflare's tunnel management interface, create a tunnel and follow the
   provided Linux or Docker connector installation instructions.
3. Add a public hostname, such as `drive.example.com`, and point its service to
   `http://selfcloud:3000` if the connector joins SelfCloud's Compose network.
   A host-installed connector can instead use `http://localhost:3000`.
4. Set `PUBLIC_ORIGIN=https://drive.example.com`, `SECURE_COOKIES=true`, and
   `TRUST_PROXY=1` in `.env`; recreate the SelfCloud container.
5. Restrict the app's published port to localhost (`BIND_ADDRESS=127.0.0.1`) when
   the connector runs on the host, or remove the port publication when the
   connector communicates exclusively through the Docker network.
6. Disable caching for the application hostname, especially `/api/*`, and test
   login, downloads, uploads, and previews from a phone outside your home Wi-Fi.

Check Cloudflare's **current request-size limits, timeout limits, and service
terms** for your plan before choosing this route. SelfCloud uses one request per
file and does not yet implement resumable/chunked uploads. A server-side 2 GB
limit does not override a proxy's smaller limit. Set the upload limit in
Administration to fit the entire path, leaving room for multipart overhead.

## Option B: Direct HTTPS with Caddy

This requires a publicly reachable home connection. Your router's WAN IP must
not be behind CGNAT; ask your ISP if unsure.

1. Create a DNS A record for `drive.example.com` pointing to your public IPv4
   address. Add AAAA only if you have working public IPv6. A changing home IP
   needs a dynamic DNS updater.
2. Forward TCP ports 80 and 443 to the Linux server. Keep port 3000 private.
3. Install Caddy on the host and bind SelfCloud to localhost using
   `BIND_ADDRESS=127.0.0.1`.
4. Configure Caddy:

```caddyfile
drive.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

5. Set `PUBLIC_ORIGIN=https://drive.example.com`, `SECURE_COOKIES=true`, and
   `TRUST_PROXY=1`. Restart SelfCloud and Caddy. Caddy handles certificate issuance
   and renewal when DNS and ports are correct.
6. Test from outside your home network. Some routers cannot reach their public
   hostname from inside the LAN without local DNS or hairpin NAT.

If you use Cloudflare DNS without its proxy, use DNS-only records. Enabling the
proxy reintroduces Cloudflare's upload limits. Trust proxy settings assume exactly
one trusted proxy hop and that clients cannot directly reach the backend.

## Which should you choose?

For a beginner or a connection behind CGNAT, a tunnel is often easier. For large
uploads without a proxy service's size limits, direct HTTPS may fit better if your
connection supports it. Your existing local files do not need to move when you
choose either approach.
