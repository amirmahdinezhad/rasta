import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('native Command-Q resolves Quit and terminates with a WebKit first responder', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-menu-test-'));
    try {
        const source = fs.readFileSync(new URL('../native/RastaManager.swift', import.meta.url), 'utf8');
        const entry = source.indexOf('\nlet manager = Manager()');
        assert.ok(entry > 0);
        const harness = `
final class QuitObserver: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) {
        print("PASS: Command-Q terminated the isolated native test process.")
    }
}
let app = NSApplication.shared
let observer = QuitObserver()
app.delegate = observer
let manager = Manager()
manager.installApplicationMenu()
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 780), styleMask: [.titled], backing: .buffered, defer: false)
let web = WKWebView(frame: window.contentView!.bounds)
window.contentView = web
window.makeFirstResponder(web)
guard window.firstResponder === web else { fatalError("WebKit must own focus.") }
guard let menu = app.mainMenu else { fatalError("Missing app menu.") }
let quit = menu.items.first!.submenu!.items.last!
guard quit.title == "Quit Rasta", quit.keyEquivalent == "q", quit.keyEquivalentModifierMask == [.command], quit.target === app else { fatalError("Invalid Quit shortcut.") }
let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.command], timestamp: 0, windowNumber: window.windowNumber, context: nil, characters: "q", charactersIgnoringModifiers: "q", isARepeat: false, keyCode: 12)!
DispatchQueue.main.async {
    _ = menu.performKeyEquivalent(with: event)
    fatalError("Quit did not terminate the test process.")
}
app.run()
`;
        const file = path.join(folder, 'main.swift'), executable = path.join(folder, 'menu-test');
        fs.writeFileSync(file, source.slice(0, entry) + harness);
        execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', file, '-o', executable], { timeout: 45000, stdio: 'pipe' });
        const output = execFileSync(executable, { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
        assert.match(output, /PASS: Command-Q terminated/);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
