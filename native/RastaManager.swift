import AppKit
import WebKit
import UniformTypeIdentifiers

private final class WindowDragView: NSView {
    private var dragStart: (cursor: NSPoint, eventLocation: NSPoint, windowOrigin: NSPoint)?
    private var cursorMoved = false

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        dragStart = (NSEvent.mouseLocation, event.locationInWindow, window.frame.origin)
        cursorMoved = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let dragStart else { return }
        let cursor = NSEvent.mouseLocation
        cursorMoved = cursorMoved || cursor != dragStart.cursor
        // Some accessibility tools deliver drag events without moving the system pointer.
        let position = cursorMoved ? cursor : event.locationInWindow
        let start = cursorMoved ? dragStart.cursor : dragStart.eventLocation
        window.setFrameOrigin(NSPoint(
            x: dragStart.windowOrigin.x + position.x - start.x,
            y: dragStart.windowOrigin.y + position.y - start.y
        ))
    }

    override func mouseUp(with event: NSEvent) {
        dragStart = nil
    }
}

// A local-only web surface uses fixed JSON RPC actions over a sandboxed native bridge.
final class Manager: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var mutating = false
    var pendingTarget: String?
    var pendingView = "connection"
    let resources = Bundle.main.resourceURL!
    func installApplicationMenu() {
        let menu = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu(title: "Rasta")
        let hide = NSMenuItem(title: "Hide Rasta", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hide.target = NSApp
        applicationMenu.addItem(hide)
        applicationMenu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Rasta", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.keyEquivalentModifierMask = [.command]
        quit.target = NSApp
        applicationMenu.addItem(quit)
        applicationItem.submenu = applicationMenu
        menu.addItem(applicationItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installApplicationMenu()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "rasta")
        configuration.userContentController.addUserScript(WKUserScript(
            source: "document.addEventListener('contextmenu', event => event.preventDefault(), true);",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.minSize = NSSize(width: 720, height: 780)
        window.title = "Rasta"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.toolbarStyle = .unified
        window.isMovableByWindowBackground = true
        window.backgroundColor = .windowBackgroundColor
        web.underPageBackgroundColor = .clear
        let content = NSView()
        let dragView = WindowDragView()
        web.translatesAutoresizingMaskIntoConstraints = false
        dragView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(web)
        content.addSubview(dragView)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: content.topAnchor),
            web.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            dragView.topAnchor.constraint(equalTo: content.topAnchor),
            dragView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 74),
            dragView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            dragView.heightAnchor.constraint(equalToConstant: 26),
        ])
        window.contentView = content
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        web.loadFileURL(resources.appendingPathComponent("runtime/bin/manager/index.html"), allowingReadAccessTo: resources.appendingPathComponent("runtime/bin"))
        NSApp.activate(ignoringOtherApps: true)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let target = pendingTarget { openConnection(target, view: pendingView); pendingTarget = nil }
        guard CommandLine.arguments.contains("--self-test") else { return }
        checkWebSurface(until: ProcessInfo.processInfo.systemUptime + 32)
    }
    private func checkWebSurface(until deadline: TimeInterval) {
        let probe = """
        JSON.stringify({
            cards: document.querySelectorAll('[id^=card-]').length,
            bridge: Boolean(window.webkit?.messageHandlers?.rasta),
            route: Boolean(window.rastaOpenConnection),
            version: /^\\d+\\.\\d+\\.\\d+$/.test(document.querySelector('header [aria-label="Rasta version"]')?.textContent ?? ''),
            contextMenuBlocked: !document.dispatchEvent(new MouseEvent('contextmenu', {cancelable:true})),
            fits: document.documentElement.scrollHeight <= innerHeight
        })
        """
        web.evaluateJavaScript(probe) { result, error in
            let evidence = result as? String ?? ""
            let report = (try? JSONSerialization.jsonObject(with: Data(evidence.utf8))) as? [String: Any]
            let required = ["bridge", "route", "version", "contextMenuBlocked", "fits"]
            if error == nil, report?["cards"] as? Int == 8, required.allSatisfy({ report?[$0] as? Bool == true }) {
                self.finishWebSurfaceTest()
            } else if ProcessInfo.processInfo.systemUptime < deadline {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.checkWebSurface(until: deadline)
                }
            } else {
                let diagnostic = evidence.isEmpty ? (error?.localizedDescription ?? "No web result") : evidence
                fputs("Manager web surface failed. \(diagnostic)\n", stderr)
                exit(1)
            }
        }
    }
    private func finishWebSurfaceTest() {
        guard let index = CommandLine.arguments.firstIndex(of: "--screenshot"), CommandLine.arguments.count > index + 1 else {
            print("PASS: native Rasta manager and local bridge loaded.")
            NSApp.terminate(nil)
            return
        }
        web.takeSnapshot(with: nil) { image, _ in
            if let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
            }
            print("PASS: native Rasta manager and local bridge loaded.")
            NSApp.terminate(nil)
        }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first, url.scheme == "rasta" else { return }
        guard url.host == "connection", ["codex", "t3", "antigravity", "gemini", "claude", "opencode", "zcode", "grokbot"].contains(String(url.path.dropFirst())) else { return }
        let target = String(url.path.dropFirst())
        let view = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "tab" })?.value == "reading" ? "reading" : "connection"
        if web?.isLoading == false { openConnection(target, view: view) } else { pendingTarget = target; pendingView = view }
        window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func openConnection(_ target: String, view: String = "connection") {
        guard let data = try? JSONSerialization.data(withJSONObject: target, options: .fragmentsAllowed), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.rastaOpenConnection(\(json), \"\(view == "reading" ? "reading" : "connection")\")", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let picker = NSOpenPanel()
        picker.allowsMultipleSelection = parameters.allowsMultipleSelection
        picker.canChooseDirectories = false
        picker.allowedContentTypes = ["ttf", "otf"].compactMap { UTType(filenameExtension: $0) }
        picker.allowsOtherFileTypes = false
        picker.beginSheetModal(for: window) { result in completionHandler(result == .OK ? picker.urls : nil) }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = resources.appendingPathComponent("runtime/bin/manager/index.html").standardizedFileURL
        decisionHandler(navigationAction.request.url?.standardizedFileURL == allowed ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              var body = message.body as? [String: Any], let id = body["id"] as? Int,
              let action = body["action"] as? String,
              ["status", "check", "download", "install", "repair", "recover", "remove", "launch", "cancel", "preferences", "font-import", "font-select", "font-remove", "reading-save", "core-check", "core-update", "core-install", "remove-connections", "remove-data"].contains(action) else { return }
        body["managerApp"] = Bundle.main.bundleURL.path
        body["parentPid"] = ProcessInfo.processInfo.processIdentifier
        let mutation = !["status", "check", "core-check", "preferences"].contains(action)
        if mutation && mutating { respond(id, ["ok": false, "error": "Another Rasta operation is running."]); return }
        if mutation { mutating = true }
        guard let input = try? JSONSerialization.data(withJSONObject: body) else { return }
        let runtime = resources.appendingPathComponent("runtime")
        DispatchQueue.global(qos: .userInitiated).async {
            let task = Process(), output = Pipe(), stdin = Pipe()
            task.executableURL = runtime.appendingPathComponent("node")
            task.arguments = [runtime.appendingPathComponent("bin/manager-service.js").path]
            task.environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("CODEX_") && $0.key != "ELECTRON_RUN_AS_NODE" && $0.key != "ARTL_TARGET" }
            task.standardOutput = output; task.standardInput = stdin; task.standardError = FileHandle.nullDevice
            var response: [String: Any]
            do {
                try task.run()
                stdin.fileHandleForWriting.write(input); try? stdin.fileHandleForWriting.close()
                let bytes = output.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
                response = (try JSONSerialization.jsonObject(with: bytes)) as? [String: Any] ?? ["ok": false, "error": "Rasta returned an invalid response."]
            } catch { response = ["ok": false, "error": "Rasta could not complete this operation. Please try again."] }
            DispatchQueue.main.async { if mutation { self.mutating = false }; self.respond(id, response)
                if action == "core-install", response["ok"] as? Bool == true { NSApp.terminate(nil) }
                if action == "remove-data", let value = response["value"] as? [String: Any], value["removeSelf"] as? Bool == true {
                    NSWorkspace.shared.recycle([Bundle.main.bundleURL]) { _, error in
                        DispatchQueue.main.async {
                            if error == nil { NSApp.terminate(nil) }
                            else { self.respond(id, ["ok": false, "error": "Connections were removed. Quit Rasta and move Rasta.app to Trash."]) }
                        }
                    }
                }
            }
        }
    }
    func respond(_ id: Int, _ value: [String: Any]) {
        guard let bytes = try? JSONSerialization.data(withJSONObject: ["id": id, "response": value]), let json = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.rastaReply(\(json))", completionHandler: nil)
    }
}
let manager = Manager()
NSApplication.shared.delegate = manager
NSApplication.shared.run()
