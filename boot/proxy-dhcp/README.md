# On-prem netboot proxy

The only piece of this system that can't live in Cloudflare/GitHub: a
proxyDHCP + TFTP server that answers PXE requests on your local network and
points machines at iPXE, which then chains to the Worker over HTTPS.

## Setup

1. Get `ipxe.efi` and `undionly.kpxe` (build from [ipxe.org](https://ipxe.org)
   or grab prebuilt binaries) into `/srv/tftp` on the proxy host.
2. Copy `dnsmasq.conf.example` to `/etc/dnsmasq.conf`, adjust `interface` and
   the Worker URL, and restart dnsmasq.
3. Make sure the proxy host sits on the same L2 segment/VLAN as the machines
   you're reimaging — proxyDHCP doesn't route.
4. PXE-boot a test machine. It should: get the real DHCP lease from your
   normal DHCP server -> get PXE boot options from dnsmasq -> load iPXE ->
   iPXE requests `https://.../boot/<mac>` -> Worker returns either the
   install script or the "no pending job" idle script.

## Three ways to get iPXE running, pick whichever fits your network

1. **This proxyDHCP setup** — for networks where you don't control the main
   DHCP server (guest routers, ISP-provided gear, shared infra).
2. **DHCP option 66/67 directly** — if you control the main DHCP server's
   "next server"/boot filename options. See
   [`dhcp-option-66-67.md`](./dhcp-option-66-67.md).
3. **UEFI HTTP(S) Boot** — no DHCP changes at all on UEFI hardware that
   supports it; the boot URL is set directly in each machine's firmware.
   See [`https-boot.md`](./https-boot.md).

All three end up running the same `embed.ipxe` chainload script — they only
differ in how the machine gets pointed at it.
