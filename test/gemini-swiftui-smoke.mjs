import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.arch !== 'arm64' || Number(os.release().split('.')[0]) < 25) {
    console.log('SwiftUI paragraph styling fixture requires macOS 26 on Apple Silicon.');
    process.exit(0);
}

const native = fileURLToPath(new URL('../native/', import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-swiftui-'));
const run = (args, options = {}) => execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8', ...options });

try {
    const provider = path.join(scratch, 'provider.m'), object = path.join(scratch, 'provider.o');
    fs.writeFileSync(provider, `
#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
static NSInteger active = -1;
static double spacing;
void RastaSetPromptFixture(NSInteger kind, double choice) { active = kind; spacing = choice; }
CFDictionaryRef RastaCopySwiftUIPromptSettings(uintptr_t caller, NSUInteger attributed) {
    if (!caller || active < 0 || attributed != (NSUInteger)(active % 2)) return NULL;
    if (active < 2) active = -1;
    if (spacing == 0) return CFBridgingRetain(@{});
    CTFontRef font = CTFontCreateWithName(CFSTR("HelveticaNeue"), 18, NULL);
    return CFBridgingRetain(@{@"font": CFBridgingRelease(font), @"spacing": @(spacing), @"force": @NO});
}
`);
    run(['clang', '-fobjc-arc', '-c', provider, '-o', object]);
    const entry = path.join(scratch, 'entry.o'), library = path.join(scratch, 'prompt.dylib');
    run(['clang', '-c', path.join(native, 'GeminiPromptInterpose.S'), '-o', entry]);
    run(['swiftc', '-O', '-parse-as-library', '-emit-library', object, entry, path.join(native, 'GeminiPromptText.swift'), '-o', library]);
    const fixture = path.join(scratch, 'fixture.swift'), executable = path.join(scratch, 'fixture');
    fs.writeFileSync(fixture, String.raw`
import AppKit
import Darwin
import SwiftUI

struct Metrics: TextRenderer {
    let record: ([CGRect]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        record(layout.map(\.typographicBounds.rect))
        for line in layout { context.draw(line) }
    }
}

final class PromptMetrics {
    var advance = 0.0
}

struct ObservedPrompt: View {
    let sample: String
    let metrics: PromptMetrics

    var body: some View {
        GeometryReader { geometry in
            Text(sample).font(.system(size: 12)).textRenderer(Metrics {
                metrics.advance = $0.count > 1 ? $0[1].midY - $0[0].midY : 0
            })
            .frame(width: geometry.size.width, alignment: .trailing)
        }
    }
}

@main struct PromptFixture {
    @MainActor static func main() throws {
        typealias Configure = @convention(c) (Int, Double) -> Void
        guard let address = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "RastaSetPromptFixture") else { exit(2) }
        let configure = unsafeBitCast(address, to: Configure.self)
        let sample = Array(repeating: "\u{0633}\u{0644}\u{0627}\u{0645}", count: 11).joined(separator: " ")
        for (kind, spacing) in [(-1, 1.4), (0, 1.4), (0, 1.8), (1, 1.4), (1, 1.8)] {
            configure(kind, spacing)
            let text = kind == 1 ? Text(AttributedString(sample)) : Text(sample)
            var lines: [CGRect] = []
            let view = text.font(.system(size: 12)).textRenderer(Metrics { lines = $0 })
                .frame(width: 125, alignment: .trailing)
            _ = ImageRenderer(content: view).nsImage
            let advances = zip(lines, lines.dropFirst()).map { $1.midY - $0.midY }
            let record: [String: Any] = ["kind": kind, "spacing": spacing, "edges": lines.map(\.maxX), "advances": advances]
            print(String(decoding: try JSONSerialization.data(withJSONObject: record), as: UTF8.self))
        }
        typealias Notify = @convention(c) () -> Void
        guard let changed = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "RastaNotifySwiftUIPromptSettings") else { exit(3) }
        let notify = unsafeBitCast(changed, to: Notify.self)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 125, height: 160),
            styleMask: [.titled], backing: .buffered, defer: false)
        let metrics = PromptMetrics()
        configure(2, 0)
        window.contentView = NSHostingView(rootView: ObservedPrompt(sample: sample, metrics: metrics))
        window.orderBack(nil)
        func draw() -> Double {
            RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.25))
            if let view = window.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
            }
            return metrics.advance
        }
        let original = draw()
        configure(2, 1.8)
        notify()
        let changedAdvance = draw()
        configure(2, 0)
        notify()
        let restored = draw()
        let live = ["original": original, "changed": changedAdvance, "restored": restored]
        print(String(decoding: try JSONSerialization.data(withJSONObject: live), as: UTF8.self))
    }
}
`);
    run(['swiftc', '-parse-as-library', fixture, '-o', executable]);
    const cases = execFileSync(executable, { encoding: 'utf8', env: { ...process.env, DYLD_INSERT_LIBRARIES: library } })
        .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(cases.length, 6);
    const [baseline, plainCompact, plainSpacious, attributedCompact, attributedSpacious, live] = cases;
    const edgeSpread = sample => Math.max(...sample.edges) - Math.min(...sample.edges);
    assert.ok(edgeSpread(baseline) > 30, 'the vendor-style fixture leaves the final line on the left');
    for (const [compact, spacious] of [[plainCompact, plainSpacious], [attributedCompact, attributedSpacious]]) {
        assert.ok(compact.edges.length > baseline.edges.length, 'larger typography changes text wrapping');
        assert.ok(edgeSpread(compact) < 8, 'the wrapped Persian lines share the right edge');
        assert.ok(compact.advances[0] > baseline.advances[0] + 5, 'the prompt uses the requested line height');
        assert.ok(spacious.advances[0] > compact.advances[0] + 5, 'the selected spacing changes the rendered baselines');
    }
    assert.ok(live.original > 0 && live.changed > live.original + 5, 'a settings save restyles the existing SwiftUI prompt');
    assert.ok(Math.abs(live.original - live.restored) < 1, 'disabling reading restores the existing SwiftUI prompt');
    console.log(JSON.stringify(cases));
} finally {
    fs.rmSync(scratch, { recursive: true, force: true });
}
