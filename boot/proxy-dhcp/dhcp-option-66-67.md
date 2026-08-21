# Booting via DHCP option 66/67 (no separate proxyDHCP box)

If you control your network's actual DHCP server (router, firewall, Windows
Server, etc.) and it lets you set options 66/67, you don't need the
`dnsmasq` proxyDHCP setup in this directory at all - point it straight at a
custom-built iPXE binary instead.

## Why a plain URL in option 67 doesn't work

- **Option 66** (`next-server` / TFTP server name) - the IP or hostname of
  the TFTP server to fetch the boot file from.
- **Option 67** (`bootfile-name`) - the file to fetch from it.

A machine's stock PXE firmware only speaks **TFTP**, not HTTPS, for this
very first fetch - so option 67 has to name a TFTP file, not a URL. The
`dnsmasq` proxyDHCP config in this directory works around that with a
second stage: it serves a stock iPXE binary first, and once iPXE itself is
running, iPXE's own DHCP request is HTTPS-capable, so dnsmasq serves it the
real boot URL on that second round.

Plain option 66/67 fields (as exposed by most routers, Windows DHCP scope
options, pfSense/OPNsense, UniFi, etc.) usually can't distinguish "raw PXE
firmware" from "iPXE re-requesting" the way `dnsmasq` can - so instead of a
two-stage DHCP dance, **bake the chainload straight into the iPXE binary**.
Every client gets the identical binary via TFTP; the moment it runs, it
already knows its own MAC and chains directly to the Worker over HTTPS - no
second DHCP round, no vendor-class matching required.

## Build it

Requires Docker (avoids needing the full iPXE build toolchain locally).
`embed.ipxe` in this directory is the script to bake in - update the domain
if yours differs from `api.osd.xcet.uk`.

```bash
git clone https://github.com/ipxe/ipxe.git
cd ipxe/src

# UEFI x86_64 (most modern hardware)
docker run --rm -v "$PWD/..:/ipxe" -w /ipxe/src ubuntu:24.04 bash -c \
  "apt-get update && apt-get install -y build-essential liblzma-dev mtools mkisofs syslinux-utils genisoimage && \
   make bin-x86_64-efi/ipxe.efi EMBED=/ipxe/boot/proxy-dhcp/embed.ipxe"

# Legacy BIOS (only if you still have non-UEFI machines)
docker run --rm -v "$PWD/..:/ipxe" -w /ipxe/src ubuntu:24.04 bash -c \
  "apt-get update && apt-get install -y build-essential liblzma-dev mtools mkisofs syslinux-utils genisoimage && \
   make bin/undionly.kpxe EMBED=/ipxe/boot/proxy-dhcp/embed.ipxe"
```

This produces `bin-x86_64-efi/ipxe.efi` and/or `bin/undionly.kpxe`, each with
the chainload script compiled in.

## Host and configure

1. Put the built binary(ies) on any TFTP server on your network (a NAS with
   TFTP enabled, `tftpd-hpa` on a small box, Windows Server's TFTP role -
   this box needs no DHCP awareness at all now, it's a plain file server).
2. On your DHCP server/scope:
   - **Option 66**: the TFTP server's IP address
   - **Option 67**: `ipxe.efi` (UEFI) or `undionly.kpxe` (legacy BIOS)
3. If your DHCP server can differentiate client architecture (option
   93/vendor-class) and you have a mix of UEFI and legacy BIOS machines, set
   the filename per-architecture. If it can't, and your fleet is UEFI-only
   (the common case today), `ipxe.efi` alone covers it.

That's the whole setup - no `dnsmasq`, no proxyDHCP process to run. The
technician Basic Auth prompt and everything past it works identically to
the proxyDHCP path, since it's the same `chain` command either way.
