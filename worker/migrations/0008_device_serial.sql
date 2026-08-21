-- The WinPE deploy GUI already reports a technician-entered hostname back to
-- the cloud at selection time; this adds the device's own hardware serial
-- number (read via WMI, no technician input needed) alongside it, so the
-- admin Devices log can show which physical machine a MAC/hostname maps to.
ALTER TABLE devices ADD COLUMN serial_number TEXT;
