import test from 'node:test';
import assert from 'node:assert/strict';
import { addNativeLoader, inspectNativeLoader, GEMINI_LIBRARY } from '../bin/lib/macho-loader.js';

// A minimal arm64 executable layout with separate command, section and signature data.
function executable({ padding = 80, signed = true } = {}) {
    const segmentSize = 152, commandSize = segmentSize + (signed ? 16 : 0);
    const section = 32 + commandSize + padding, signature = section + 128;
    const bytes = Buffer.alloc(signature + (signed ? 64 : 0));
    bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(0x100000c, 4);
    bytes.writeUInt32LE(2, 12); bytes.writeUInt32LE(signed ? 2 : 1, 16);
    bytes.writeUInt32LE(commandSize, 20);
    bytes.writeUInt32LE(0x19, 32); bytes.writeUInt32LE(segmentSize, 36);
    bytes.writeUInt32LE(1, 96);
    bytes.writeBigUInt64LE(128n, 144); bytes.writeUInt32LE(section, 152);
    if (signed) {
        bytes.writeUInt32LE(0x1d, 184); bytes.writeUInt32LE(16, 188);
        bytes.writeUInt32LE(signature, 192); bytes.writeUInt32LE(64, 196);
        bytes.fill(0xaa, signature);
    }
    bytes.fill(0xbb, section, signature);
    return bytes;
}

test('native loader uses only zero header padding and preserves every original section byte', () => {
    for (const signed of [true, false]) {
        const original = executable({ signed }), copy = Buffer.from(original);
        const before = inspectNativeLoader(original), patched = addNativeLoader(original);
        const after = inspectNativeLoader(patched);
        assert.deepEqual(original, copy, 'preparation does not modify the input buffer');
        assert.equal(after.linked, true); assert.equal(after.count, before.count + 1);
        assert.equal(after.firstSection, before.firstSection); assert.equal(after.signature, before.signature);
        assert.equal(after.codeHash, before.codeHash);
        assert.deepEqual(patched.subarray(before.firstSection), original.subarray(before.firstSection));
        assert.deepEqual(patched.subarray(0, 16), original.subarray(0, 16));
        assert.deepEqual(patched.subarray(24, before.end), original.subarray(24, before.end));
        assert.equal(patched.toString('utf8', before.end + 24, before.end + 24 + GEMINI_LIBRARY.length), GEMINI_LIBRARY);
        assert.throws(() => addNativeLoader(patched), /already contains/);
    }
});

test('native loader rejects insufficient or occupied padding without moving the code', () => {
    assert.throws(() => addNativeLoader(executable({ padding: 48 })), /no verified space/);
    const occupied = executable(); occupied[inspectNativeLoader(occupied).end] = 1;
    assert.throws(() => addNativeLoader(occupied), /no verified space/);
});

test('native loader rejects incompatible architectures and malformed ranges', () => {
    for (const [offset, value, message] of [
        [0, 0xcafebabe, /different executable adapter/],
        [4, 0x1000007, /different executable adapter/],
        [8, 2, /different executable adapter/],
        [12, 6, /different executable adapter/],
        [16, 0xffff, /header/],
        [20, 0xffff, /header/],
        [36, 0, /command length/],
        [96, 2, /section table/],
        [152, 64, /section range/],
        [152, 0xffffffff, /section range/],
        [192, 32, /signature range/],
        [196, 0xffffffff, /signature range/],
    ]) {
        const bytes = executable(); bytes.writeUInt32LE(value, offset);
        assert.throws(() => inspectNativeLoader(bytes), message, `field at ${offset}`);
    }
    const overlap = executable(); overlap.writeBigUInt64LE(200n, 144);
    assert.throws(() => inspectNativeLoader(overlap), /section range|executable layout/);
    assert.throws(() => inspectNativeLoader(Buffer.alloc(8)), /different executable adapter/);
});
