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

## Why not skip proxyDHCP and set DHCP option 66/67 directly?

You can, if you control the main DHCP server (e.g. a router/firewall that
lets you set the "next server"/boot filename options) — that removes the
need for a separate proxyDHCP box entirely. `dnsmasq --proxy-dhcp` is the
fallback for networks where you don't control the DHCP server (guest
routers, ISP-provided gear, shared infra).
