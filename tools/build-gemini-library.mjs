import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const native = fileURLToPath(new URL('../native/', import.meta.url));

export function buildGeminiLibrary(output, architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64') {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-compile-'));
    const target = ['-target', `${architecture}-apple-macosx13.5`];
    try {
        const objects = ['GeminiHost.m', 'GeminiTextProbe.m', 'GeminiPromptInterpose.S'].map(name => {
            const object = path.join(scratch, name + '.o');
            execFileSync('/usr/bin/xcrun', ['clang', ...target, '-fobjc-arc', '-O2', '-c',
                path.join(native, name), '-o', object], { stdio: 'inherit' });
            return object;
        });
        execFileSync('/usr/bin/xcrun', ['swiftc', ...target, '-O', '-parse-as-library', '-emit-library', '-module-name', 'RastaGemini',
            '-framework', 'AppKit', '-framework', 'CoreText', '-framework', 'WebKit', '-framework', 'UniformTypeIdentifiers', ...objects,
            path.join(native, 'GeminiPromptText.swift'), '-o', output], { stdio: 'inherit' });
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
