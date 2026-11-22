import { createHash } from 'node:crypto';

export const GEMINI_LIBRARY = '@executable_path/Rasta.dylib';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Inspect a thin arm64 executable before considering changes to unused header padding. */
export function inspectNativeLoader(bytes) {
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x100000c
        || bytes.readUInt32LE(8) !== 0 || bytes.readUInt32LE(12) !== 2) throw Error('This native app needs a different executable adapter.');
    const count = bytes.readUInt32LE(16), size = bytes.readUInt32LE(20), end = 32 + size;
    if (end > bytes.length || size % 8 || !count || count > size / 8) throw Error('Invalid native executable header.');
    let position = 32, firstSection = bytes.length, lastSection = 0, signature = bytes.length, signed = false, linked = false;
    for (let index = 0; index < count; index++) {
        if (position + 8 > end) throw Error('Invalid native executable command.');
        const command = bytes.readUInt32LE(position), length = bytes.readUInt32LE(position + 4);
        if (length < 8 || length % 8 || position + length > end) throw Error('Invalid native executable command length.');
        if (command === 0x19) {
            if (length < 72) throw Error('Invalid native segment.');
            const sections = bytes.readUInt32LE(position + 64);
            if (72 + sections * 80 > length) throw Error('Invalid native section table.');
            for (let section = 0; section < sections; section++) {
                const start = position + 72 + section * 80;
                const offset = bytes.readUInt32LE(start + 48), flags = bytes.readUInt32LE(start + 64) & 0xff;
                const sectionSize = bytes.readBigUInt64LE(start + 40);
                if ([1, 0xc, 0x12].includes(flags) || sectionSize === 0n) continue;
                if (offset < end || sectionSize > BigInt(bytes.length - offset)) throw Error('Invalid native section range.');
                firstSection = Math.min(firstSection, offset);
                lastSection = Math.max(lastSection, offset + Number(sectionSize));
            }
        }
        if (command === 0x1d) {
            if (length < 16 || signed) throw Error('Invalid native signature command.');
            signed = true;
            signature = bytes.readUInt32LE(position + 8);
            const signatureSize = bytes.readUInt32LE(position + 12);
            if (signature < end || signatureSize > bytes.length - signature) throw Error('Invalid native signature range.');
        }
        if (command === 0xc) {
            if (length < 24) throw Error('Invalid native library command.');
            const offset = bytes.readUInt32LE(position + 8);
            if (offset < 24 || offset >= length) throw Error('Invalid native library name.');
            const limit = bytes.indexOf(0, position + offset);
            if (limit < 0 || limit >= position + length) throw Error('Invalid native library name terminator.');
            linked ||= bytes.toString('utf8', position + offset, limit) === GEMINI_LIBRARY;
        }
        position += length;
    }
    if (position !== end || firstSection < end || signature <= firstSection || lastSection > signature) throw Error('Invalid native executable layout.');
    return { count, end, firstSection, signature, linked,
        codeHash: digest(bytes.subarray(firstSection, signature)) };
}

export function addNativeLoader(original) {
    const layout = inspectNativeLoader(original);
    if (layout.linked) throw Error('The native executable already contains a Rasta loader.');
    const name = Buffer.from(GEMINI_LIBRARY + '\0');
    const command = Buffer.alloc(Math.ceil((24 + name.length) / 8) * 8);
    command.writeUInt32LE(0xc, 0);
    command.writeUInt32LE(command.length, 4);
    command.writeUInt32LE(24, 8);
    name.copy(command, 24);
    if (layout.firstSection - layout.end < command.length
        || original.subarray(layout.end, layout.end + command.length).some(byte => byte !== 0))
        throw Error('The native executable has no verified space for the Rasta loader.');
    const patched = Buffer.from(original);
    patched.writeUInt32LE(layout.count + 1, 16);
    patched.writeUInt32LE(layout.end - 32 + command.length, 20);
    command.copy(patched, layout.end);
    if (inspectNativeLoader(patched).codeHash !== layout.codeHash) throw Error('Original native executable data changed.');
    return patched;
}
