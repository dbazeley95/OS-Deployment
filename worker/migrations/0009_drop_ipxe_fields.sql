-- The iPXE netboot path (boot/proxy-dhcp/, worker/src/routes/boot.ts,
-- worker/src/lib/ipxe.ts) is removed entirely - it depended on a
-- custom-built, unsigned ipxe.efi that Secure Boot rejects, and the WinPE
-- path (boot/winpe/) is the only supported deployment path now. These
-- columns had no other purpose.
ALTER TABLE os_profiles DROP COLUMN kernel_key;
ALTER TABLE os_profiles DROP COLUMN initrd_key;
