# Booting via UEFI HTTP(S) Boot (no TFTP, no DHCP options at all)

Most UEFI firmware from the last ~7 years (Dell, HP, Lenovo, and most
business/enterprise-grade hardware) has a built-in HTTP(S) client and can
fetch a boot file directly over HTTPS - no TFTP, no proxyDHCP, and often no
DHCP configuration at all. The fetched file just needs to be a UEFI
executable, so it can be `ipxe.efi` itself: point HTTPS Boot at our iPXE
binary, and everything past that (the technician auth prompt, the OS menu)
works exactly as it does via the other two boot paths in this directory.

This is often the simplest option when a technician is already physically at
each machine to trigger network boot anyway, since the boot URL can be set
once directly in that machine's firmware setup screen - no DHCP server
changes needed at all.

## Upload the iPXE binary

Same `embed.ipxe` as the other boot paths (see `../proxy-dhcp/embed.ipxe` and
`dhcp-option-66-67.md` for how it's built) - upload the resulting
`ipxe.efi` into R2 so it's reachable over HTTPS through the Worker's
`/images/*` route:

```bash
scripts/upload-image.sh ./ipxe.efi ipxe.efi
```

That makes it available at `https://api.osd.xcet.uk/images/ipxe.efi`.

## Configure each machine

1. Enter UEFI/BIOS setup on the target machine.
2. Find the HTTP(S) Boot setting (varies by OEM - often under "Network
   Boot", "Network Stack Configuration", or similar). Enable it.
3. Set the boot URI to `https://api.osd.xcet.uk/images/ipxe.efi`.
4. Set network boot / HTTP(S) Boot as the (or a) boot option, and boot.

Some firmware instead offers this via DHCP (client identifies itself with
vendor-class `HTTPClient` rather than `PXEClient`, and the server responds
with a URL instead of a TFTP filename) - if your DHCP server can match on
vendor-class the way it would for architecture-specific option 66/67
entries, you can serve the same URL that way instead of configuring each
machine's firmware by hand.

## Caveats

- **UEFI only** - no legacy BIOS equivalent. Older BIOS-only machines still
  need one of the other two boot paths in this directory.
- **Certificate trust varies by firmware** - HTTPS Boot validates the
  server's TLS certificate against the firmware's own built-in CA trust
  store, not the OS's. Cloudflare's certificate should validate on most
  modern firmware (they generally ship common public root CAs), but this
  is worth testing on your actual hardware models before relying on it -
  some older or budget firmware ships a much smaller trusted CA set, or
  requires importing a CA certificate manually.
- **Not all firmware supports HTTPS specifically** - some only support
  plain HTTP Boot. If that's your only option on some hardware, be aware
  the initial `ipxe.efi` fetch itself would then be unencrypted (everything
  downstream - the Basic Auth prompt, the actual OS install - still goes
  over HTTPS regardless, since that's iPXE's own behavior once it's
  running, not the firmware's).
- **HTTP(S) Boot may need enabling** - some firmware ships with it present
  but disabled by default, or needs a firmware update on older models.
