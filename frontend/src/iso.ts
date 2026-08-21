// Extracts a single file (by path) out of a UDF-formatted disc image (.iso)
// entirely client-side, using only the byte ranges needed to walk the
// filesystem metadata - never reading the whole image into memory. Windows
// installation media is UDF (ECMA-167/OSTA UDF), not plain ISO9660, because
// install.wim/install.esd routinely exceed ISO9660's 4GB file size limit.
//
// This lets the OS profiles form accept a full Windows ISO and pull out
// just install.wim's bytes for upload, without ever storing or uploading
// the surrounding ~5-6GB image.
//
// Reference: ECMA-167 3rd edition / OSTA UDF 2.60. Only what a mastered,
// read-only Windows ISO actually uses is implemented: a single partition
// (Type 1 partition map), File Entries and Extended File Entries, short_ad/
// long_ad allocation descriptors (including the "continuation extent"
// case), and embedded (in-ICB) file/directory data.

const SECTOR_SIZE = 2048;

export interface ByteSource {
  size: number;
  slice(start: number, end: number): Blob;
}

function toByteSource(blob: Blob): ByteSource {
  return { size: blob.size, slice: (start, end) => blob.slice(start, end) };
}

async function readSectors(src: ByteSource, sector: number, count: number): Promise<DataView> {
  const start = sector * SECTOR_SIZE;
  const end = Math.min(start + count * SECTOR_SIZE, src.size);
  const buf = await src.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function tagIdentifier(view: DataView): number {
  return view.getUint16(0, true);
}

interface LbAddr {
  logicalBlockNumber: number;
  partitionReferenceNumber: number;
}

interface Ad {
  extentType: number; // top 2 bits of the length field
  length: number; // low 30 bits: byte length
  // Absolute LBA once resolved against a partition map; undefined until resolved.
  partitionReferenceNumber: number;
  logicalBlockNumber: number;
}

function readLbAddr(view: DataView, offset: number): LbAddr {
  return {
    logicalBlockNumber: view.getUint32(offset, true),
    partitionReferenceNumber: view.getUint16(offset + 4, true),
  };
}

function readLongAd(view: DataView, offset: number): Ad {
  const rawLength = view.getUint32(offset, true);
  const lb = readLbAddr(view, offset + 4);
  return {
    extentType: rawLength >>> 30,
    length: rawLength & 0x3fffffff,
    partitionReferenceNumber: lb.partitionReferenceNumber,
    logicalBlockNumber: lb.logicalBlockNumber,
  };
}

function readShortAd(view: DataView, offset: number, partitionReferenceNumber: number): Ad {
  const rawLength = view.getUint32(offset, true);
  return {
    extentType: rawLength >>> 30,
    length: rawLength & 0x3fffffff,
    partitionReferenceNumber,
    logicalBlockNumber: view.getUint32(offset + 4, true),
  };
}

interface PartitionDescriptor {
  partitionNumber: number;
  startingLocation: number; // absolute LBA
}

interface VolumeInfo {
  partitions: PartitionDescriptor[];
  partitionMapPartitionNumbers: number[]; // index = partitionReferenceNumber
  fsdLocation: LbAddr; // pointer to the File Set Descriptor itself, not the root dir
}

function partitionStartFor(vol: VolumeInfo, partitionReferenceNumber: number): number {
  const partitionNumber = vol.partitionMapPartitionNumbers[partitionReferenceNumber];
  const pd = vol.partitions.find((p) => p.partitionNumber === partitionNumber);
  if (!pd) throw new Error(`UDF: no partition descriptor for partition ${partitionNumber}`);
  return pd.startingLocation;
}

function absoluteLba(vol: VolumeInfo, lb: LbAddr): number {
  return partitionStartFor(vol, lb.partitionReferenceNumber) + lb.logicalBlockNumber;
}

async function readAnchorVolumeDescriptor(src: ByteSource): Promise<{ location: number; length: number }> {
  const view = await readSectors(src, 256, 1);
  if (tagIdentifier(view) !== 2) {
    throw new Error("Not a UDF image (no Anchor Volume Descriptor Pointer at sector 256)");
  }
  return { length: view.getUint32(16, true), location: view.getUint32(20, true) };
}

async function readVolumeInfo(src: ByteSource, avdp: { location: number; length: number }): Promise<VolumeInfo> {
  const sectorCount = Math.ceil(avdp.length / SECTOR_SIZE);
  const partitions: PartitionDescriptor[] = [];
  let partitionMapPartitionNumbers: number[] = [];
  let fsdLocation: LbAddr | null = null;

  for (let i = 0; i < sectorCount; i++) {
    const view = await readSectors(src, avdp.location + i, 1);
    const tag = tagIdentifier(view);
    if (tag === 8) break; // Terminating Descriptor
    if (tag === 5) {
      // Partition Descriptor
      partitions.push({
        partitionNumber: view.getUint16(22, true),
        startingLocation: view.getUint32(188, true),
      });
    } else if (tag === 6) {
      // Logical Volume Descriptor
      const mapTableLength = view.getUint32(264, true);
      const numberOfPartitionMaps = view.getUint32(268, true);
      const maps: number[] = [];
      let off = 440;
      const mapsEnd = 440 + mapTableLength;
      for (let m = 0; m < numberOfPartitionMaps && off < mapsEnd; m++) {
        const mapType = view.getUint8(off);
        const mapLength = view.getUint8(off + 1);
        if (mapType === 1) {
          // Type 1 (physical) partition map: PartitionNumber at +4 (u16)
          maps.push(view.getUint16(off + 4, true));
        } else {
          throw new Error(`UDF: unsupported partition map type ${mapType}`);
        }
        off += mapLength;
      }
      partitionMapPartitionNumbers = maps;
      // LogicalVolumeContentsUse (offset 248) holds a long_ad pointing at the FSD.
      const fsdAd = readLongAd(view, 248);
      fsdLocation = { logicalBlockNumber: fsdAd.logicalBlockNumber, partitionReferenceNumber: fsdAd.partitionReferenceNumber };
    }
  }

  if (!fsdLocation) throw new Error("UDF: no Logical Volume Descriptor found");
  if (partitions.length === 0) throw new Error("UDF: no Partition Descriptor found");
  return { partitions, partitionMapPartitionNumbers, fsdLocation };
}

/** Reads the File Set Descriptor and returns the ICB of the root directory's File Entry. */
async function readRootDirectoryIcb(src: ByteSource, vol: VolumeInfo): Promise<LbAddr> {
  const lba = absoluteLba(vol, vol.fsdLocation);
  const view = await readSectors(src, lba, 1);
  if (tagIdentifier(view) !== 256) {
    throw new Error(`UDF: expected File Set Descriptor, got tag ${tagIdentifier(view)}`);
  }
  const rootAd = readLongAd(view, 400);
  return { logicalBlockNumber: rootAd.logicalBlockNumber, partitionReferenceNumber: rootAd.partitionReferenceNumber };
}

interface FileEntryInfo {
  fileType: number; // 4 = directory, 5 = file
  informationLength: number;
  // Either a fully-resolved list of data extents (absolute byte offset + length,
  // in file order), or embedded data read directly from the ICB itself.
  extents?: { byteOffset: number; byteLength: number }[];
  embedded?: ArrayBuffer;
}

async function readFileEntry(src: ByteSource, vol: VolumeInfo, icb: LbAddr): Promise<FileEntryInfo> {
  const lba = absoluteLba(vol, icb);
  let view = await readSectors(src, lba, 1);
  const tag = tagIdentifier(view);
  if (tag !== 261 && tag !== 266) {
    throw new Error(`UDF: expected File Entry or Extended File Entry, got tag ${tag}`);
  }
  const extended = tag === 266;
  const headerSize = extended ? 216 : 176;
  const infoLenOffset = extended ? 56 : 56;
  const leaOffset = extended ? 208 : 168;
  const ladOffset = extended ? 212 : 172;

  const readHeader = (v: DataView) => ({
    fileType: v.getUint8(27), // icbTag starts at absolute offset 16; FileType is icbTag+11 = 27
    addressingType: v.getUint16(34, true) & 0x7, // icbTag.Flags (u16) is icbTag+18 = 34; low 3 bits = AD type
    informationLength: Number(v.getBigUint64(infoLenOffset, true)),
    lengthOfExtendedAttributes: v.getUint32(leaOffset, true),
    lengthOfAllocationDescriptors: v.getUint32(ladOffset, true),
  });

  let header = readHeader(view);
  const totalRecordLength = headerSize + header.lengthOfExtendedAttributes + header.lengthOfAllocationDescriptors;
  const neededSectors = Math.ceil(totalRecordLength / SECTOR_SIZE);
  if (neededSectors > 1) {
    view = await readSectors(src, lba, neededSectors);
    header = readHeader(view);
  }

  const adAreaStart = headerSize + header.lengthOfExtendedAttributes;
  const adAreaLength = header.lengthOfAllocationDescriptors;

  if (header.addressingType === 3) {
    // Embedded (in-ICB) data: the allocation descriptors area *is* the file content.
    const start = view.byteOffset + adAreaStart;
    const bytes = new Uint8Array(view.buffer, start, header.informationLength).slice();
    return { fileType: header.fileType, informationLength: header.informationLength, embedded: bytes.buffer };
  }
  if (header.addressingType !== 0 && header.addressingType !== 1) {
    throw new Error(`UDF: unsupported allocation descriptor addressing type ${header.addressingType}`);
  }

  const isLong = header.addressingType === 1;
  const adSize = isLong ? 16 : 8;

  const extents: { byteOffset: number; byteLength: number }[] = [];
  let consumed = 0;
  let currentView = view;
  let currentBase = adAreaStart;
  let currentLength = adAreaLength;
  let currentLba = lba;

  while (consumed < header.informationLength) {
    let offset = currentBase;
    let usedAllInThisArea = false;
    while (offset + adSize <= currentBase + currentLength) {
      const ad = isLong ? readLongAd(currentView, offset) : readShortAd(currentView, offset, icb.partitionReferenceNumber);
      offset += adSize;

      if (ad.extentType === 2) {
        // Not allocated, not recorded - shouldn't appear in a finalized image.
        throw new Error("UDF: unexpected unallocated extent in a read-only image");
      }
      if (ad.extentType === 3) {
        // Continuation: the extent described here holds more allocation descriptors.
        const contLba = partitionStartFor(vol, ad.partitionReferenceNumber) + ad.logicalBlockNumber;
        const contSectors = Math.ceil(ad.length / SECTOR_SIZE);
        currentView = await readSectors(src, contLba, contSectors);
        currentBase = 0;
        currentLength = ad.length;
        currentLba = contLba;
        usedAllInThisArea = true;
        break;
      }

      // extentType 0 (recorded & allocated) or 1 (allocated, not recorded - treat as a
      // hole; shouldn't occur here, but length is still accurate) both describe real space.
      if (ad.length > 0) {
        const absLba = partitionStartFor(vol, ad.partitionReferenceNumber) + ad.logicalBlockNumber;
        extents.push({ byteOffset: absLba * SECTOR_SIZE, byteLength: ad.length });
        consumed += ad.length;
      }
      if (consumed >= header.informationLength) break;
    }
    if (!usedAllInThisArea) break;
  }

  void currentLba;
  return { fileType: header.fileType, informationLength: header.informationLength, extents };
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
  icb: LbAddr;
}

function decodeDstring(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const compressionId = bytes[0];
  const rest = bytes.subarray(1);
  if (compressionId === 8) {
    return String.fromCharCode(...rest);
  }
  if (compressionId === 16) {
    const chars: number[] = [];
    for (let i = 0; i + 1 < rest.length; i += 2) {
      chars.push((rest[i] << 8) | rest[i + 1]);
    }
    return String.fromCharCode(...chars);
  }
  throw new Error(`UDF: unsupported filename compression id ${compressionId}`);
}

async function readDirectoryContent(src: ByteSource, vol: VolumeInfo, icb: LbAddr): Promise<ArrayBuffer> {
  const entry = await readFileEntry(src, vol, icb);
  if (entry.fileType !== 4) throw new Error("UDF: expected a directory");
  if (entry.embedded) return entry.embedded;

  const parts: ArrayBuffer[] = [];
  for (const ext of entry.extents ?? []) {
    const buf = await src.slice(ext.byteOffset, ext.byteOffset + ext.byteLength).arrayBuffer();
    parts.push(buf);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), pos);
    pos += p.byteLength;
  }
  return out.buffer.slice(0, entry.informationLength);
}

function parseDirectoryEntries(buf: ArrayBuffer): DirEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const entries: DirEntry[] = [];
  let offset = 0;
  while (offset + 38 <= buf.byteLength) {
    if (tagIdentifier(new DataView(buf, offset, Math.min(16, buf.byteLength - offset))) !== 257) {
      break;
    }
    const fileCharacteristics = view.getUint8(offset + 18);
    const lengthOfFileIdentifier = view.getUint8(offset + 19);
    const icb = readLongAd(view, offset + 20);
    const lengthOfImplementationUse = view.getUint16(offset + 36, true);
    const nameStart = offset + 38 + lengthOfImplementationUse;
    const isParent = (fileCharacteristics & 0x08) !== 0;
    const isDirectory = (fileCharacteristics & 0x02) !== 0;

    if (!isParent && lengthOfFileIdentifier > 0) {
      const nameBytes = bytes.subarray(nameStart, nameStart + lengthOfFileIdentifier);
      entries.push({
        name: decodeDstring(nameBytes),
        isDirectory,
        icb: { logicalBlockNumber: icb.logicalBlockNumber, partitionReferenceNumber: icb.partitionReferenceNumber },
      });
    }

    const recordLength = 38 + lengthOfImplementationUse + lengthOfFileIdentifier;
    const padding = (4 - (recordLength % 4)) % 4;
    offset += recordLength + padding;
  }
  return entries;
}

/**
 * Locates a file by path (e.g. ["sources", "install.wim"]) inside a UDF disc
 * image and returns its size plus a slice() function reading directly out of
 * the original image - no data is copied or held in memory beyond what's
 * needed to walk directory metadata (typically a few KB).
 */
export async function extractFromIso(
  isoBlob: Blob,
  pathSegments: string[]
): Promise<{ size: number; slice(start: number, end: number): Blob }> {
  const src = toByteSource(isoBlob);
  const avdp = await readAnchorVolumeDescriptor(src);
  const vol = await readVolumeInfo(src, avdp);

  let currentIcb = await readRootDirectoryIcb(src, vol);
  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i];
    const isLast = i === pathSegments.length - 1;
    const dirBuf = await readDirectoryContent(src, vol, currentIcb);
    const entries = parseDirectoryEntries(dirBuf);
    const match = entries.find((e) => e.name.toLowerCase() === segment.toLowerCase() && e.isDirectory !== isLast);
    if (!match) {
      throw new Error(`Not found in ISO: ${pathSegments.slice(0, i + 1).join("/")}`);
    }
    currentIcb = match.icb;
  }

  const fileEntry = await readFileEntry(src, vol, currentIcb);
  if (fileEntry.fileType !== 5) throw new Error(`${pathSegments.join("/")} is not a regular file`);

  if (fileEntry.embedded) {
    const data = fileEntry.embedded;
    return {
      size: fileEntry.informationLength,
      slice: (start, end) => new Blob([data.slice(start, end)]),
    };
  }

  const extents = fileEntry.extents ?? [];
  // Precompute each extent's position in the logical (uncompressed file
  // content) address space, so slice() can map a logical range back to
  // absolute ISO byte ranges regardless of fragmentation.
  const logicalStarts: number[] = [];
  let running = 0;
  for (const ext of extents) {
    logicalStarts.push(running);
    running += ext.byteLength;
  }

  return {
    size: fileEntry.informationLength,
    slice(start: number, end: number): Blob {
      const parts: Blob[] = [];
      for (let i = 0; i < extents.length; i++) {
        const extStart = logicalStarts[i];
        const extEnd = extStart + extents[i].byteLength;
        const overlapStart = Math.max(start, extStart);
        const overlapEnd = Math.min(end, extEnd);
        if (overlapStart >= overlapEnd) continue;
        const absStart = extents[i].byteOffset + (overlapStart - extStart);
        const absEnd = absStart + (overlapEnd - overlapStart);
        parts.push(isoBlob.slice(absStart, absEnd));
      }
      return new Blob(parts);
    },
  };
}

const WIM_CANDIDATES = [
  ["sources", "install.wim"],
  ["sources", "install.esd"],
];

/** Finds install.wim (preferred) or install.esd under /sources on a Windows ISO. */
export async function findWindowsWimInIso(
  isoBlob: Blob
): Promise<{ name: string; size: number; slice(start: number, end: number): Blob }> {
  let lastError: unknown;
  for (const path of WIM_CANDIDATES) {
    try {
      const result = await extractFromIso(isoBlob, path);
      return { name: path[path.length - 1], size: result.size, slice: result.slice };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    "Could not find sources/install.wim or sources/install.esd on this ISO. " +
      (lastError instanceof Error ? lastError.message : "")
  );
}
