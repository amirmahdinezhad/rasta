import AppKit
import CryptoKit
import Security

private struct KeychainHost {
    let identifier: String
    let team: String
    let appName: String
    let credentialService: String?

    static let supported = [
        "t3": Self(identifier: "com.t3tools.t3code", team: "ARK85ZXQ4Z", appName: "t3code", credentialService: nil),
        "claude": Self(identifier: "com.anthropic.claudefordesktop", team: "Q6L2SF6YDW", appName: "Claude", credentialService: nil),
        "zcode": Self(identifier: "dev.zcode.app", team: "8A5X4JJ39T", appName: "ZCode",
                      credentialService: "ZCode Credential Encryption"),
    ]
}

private typealias CreateTrustedApplication = @convention(c) (
    UnsafePointer<CChar>, SecRequirement, UnsafeMutablePointer<Unmanaged<SecTrustedApplication>?>
) -> OSStatus
private typealias CopyTrustedRequirement = @convention(c) (
    SecTrustedApplication, UnsafeMutablePointer<Unmanaged<SecRequirement>?>
) -> OSStatus

private func checked(_ status: OSStatus) throws {
    if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
}

private func requireValue<T>(_ value: T?) throws -> T {
    guard let value else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecParam)) }
    return value
}

private func signingRequirement(_ rule: String) throws -> SecRequirement {
    var requirement: SecRequirement?
    try checked(SecRequirementCreateWithString(rule as CFString, [], &requirement))
    return try requireValue(requirement)
}

private func staticCode(_ file: String) throws -> SecStaticCode {
    var code: SecStaticCode?
    try checked(SecStaticCodeCreateWithPath(URL(fileURLWithPath: file) as CFURL, [], &code))
    return try requireValue(code)
}

private func requirementData(_ requirement: SecRequirement) throws -> Data {
    var data: CFData?
    try checked(SecRequirementCopyData(requirement, [], &data))
    return try requireValue(data) as Data
}

private func designatedRequirement(_ code: SecStaticCode) throws -> Data {
    var requirement: SecRequirement?
    try checked(SecCodeCopyDesignatedRequirement(code, [], &requirement))
    return try requirementData(requireValue(requirement))
}

private func safeStorageItems(for host: KeychainHost, in keychain: SecKeychain) throws -> [SecKeychainItem] {
    let service = "\(host.appName) Safe Storage"
    // Electron versions and storage providers use either account for this service.
    return try [host.appName, "\(host.appName) Key"].compactMap { account in
        var item: SecKeychainItem?
        let status = service.withCString { serviceName in
            account.withCString { accountName in
                SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), serviceName,
                    UInt32(account.utf8.count), accountName, nil, nil, &item)
            }
        }
        if status == errSecItemNotFound { return nil }
        try checked(status)
        return try requireValue(item)
    }
}

private func hostKeychainItems(for host: KeychainHost, in keychain: SecKeychain) throws -> [SecKeychainItem] {
    let items = try safeStorageItems(for: host, in: keychain)
    guard let service = host.credentialService else { return items }
    // ZCode derives the account name, so match its exact service and return item references only.
    let query: [CFString: Any] = [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: service,
        kSecMatchSearchList: [keychain],
        kSecReturnRef: true,
        kSecMatchLimit: kSecMatchLimitAll,
    ]
    var matches: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &matches)
    if status == errSecItemNotFound { return items }
    try checked(status)
    return items + (try requireValue(matches as? [SecKeychainItem]))
}

private func authorizeHostKeychain(target: String, candidate: String, original: String) throws {
    let host = try requireValue(KeychainHost.supported[target])
    let source = try staticCode(original)
    let staged = try staticCode(candidate)
    let strict = SecCSFlags(rawValue: kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures)
    let publisher = try signingRequirement("""
        identifier "\(host.identifier)" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "\(host.team)"
        """)
    try checked(SecStaticCodeCheckValidity(source, strict, publisher))
    try checked(SecStaticCodeCheckValidity(staged, strict, nil))
    let vendorRule = try designatedRequirement(source)
    guard try designatedRequirement(staged) == vendorRule else {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecCSReqFailed))
    }
    var information: CFDictionary?
    try checked(SecCodeCopySigningInformation(staged, SecCSFlags(rawValue: kSecCSSigningInformation), &information))
    let signing = try requireValue(information) as NSDictionary
    let digest = try requireValue(signing[kSecCodeInfoUnique] as? Data)
    guard signing[kSecCodeInfoIdentifier] as? String == host.identifier, digest.count == 20 else {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecCSReqFailed))
    }
    let hex = digest.map { String(format: "%02x", $0) }.joined()
    let exactRule = try signingRequirement("identifier \"\(host.identifier)\" and cdhash H\"\(hex)\"")
    try checked(SecStaticCodeCheckValidity(staged, [], exactRule))
    let exactData = try requirementData(exactRule)

    let login = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Keychains/login.keychain-db")
    var keychain: SecKeychain?
    try checked(login.path.withCString { SecKeychainOpen($0, &keychain) })
    for item in try hostKeychainItems(for: host, in: requireValue(keychain)) {
        try authorizeKeychainItem(item, target: target, vendorRule: vendorRule, exactRule: exactRule, exactData: exactData)
    }
}

private func authorizeKeychainItem(_ item: SecKeychainItem, target: String, vendorRule: Data,
                                   exactRule: SecRequirement, exactData: Data) throws {
    // These Security framework functions create a trusted application from a requirement.
    // The public path-based initializer copies the vendor requirement that the staged host cannot satisfy.
    let framework = try requireValue(dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY))
    defer { dlclose(framework) }
    let create = unsafeBitCast(try requireValue(dlsym(framework, "SecTrustedApplicationCreateFromRequirement")), to: CreateTrustedApplication.self)
    let copy = unsafeBitCast(try requireValue(dlsym(framework, "SecTrustedApplicationCopyRequirement")), to: CopyTrustedRequirement.self)
    var access: SecAccess?
    try checked(SecKeychainItemCopyAccess(item, &access))
    let permissions = try requireValue(access)
    let entries = SecAccessCopyMatchingACLList(permissions, kSecACLAuthorizationDecrypt) as? [SecACL] ?? []
    guard entries.count == 1, let entry = entries.first else {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecACLNotSimple))
    }
    var applications: CFArray?
    var description: CFString?
    var prompt = SecKeychainPromptSelector(rawValue: 0)
    try checked(SecACLCopyContents(entry, &applications, &description, &prompt))
    let trusted = try requireValue(applications as? [SecTrustedApplication])
    let label = "csreq://dev.rasta.safe-storage.\(target)"
    var containsVendor = false
    var hasExactGrant = false
    for application in trusted {
        var requirement: Unmanaged<SecRequirement>?
        try checked(copy(application, &requirement))
        let data = try requirement.map { try requirementData($0.takeRetainedValue()) }
        containsVendor = containsVendor || data == vendorRule
        hasExactGrant = hasExactGrant || data == exactData
    }
    guard containsVendor else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(errSecACLNotSimple)) }
    if hasExactGrant { return }

    // Previous exact grants remain valid if the installation rolls back.
    var application: Unmanaged<SecTrustedApplication>?
    try checked(label.withCString { create($0, exactRule, &application) })
    let updated = trusted + [try requireValue(application).takeRetainedValue()]
    try checked(SecACLSetContents(entry, updated as CFArray, try requireValue(description), prompt))
    // macOS authorizes the ACL change. Rasta neither reads the item nor handles the password.
    try checked(SecKeychainItemSetAccess(item, permissions))
}

if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--authorize-host-keychain" {
    do {
        try authorizeHostKeychain(target: CommandLine.arguments[2], candidate: CommandLine.arguments[3], original: CommandLine.arguments[4])
        exit(0)
    } catch {
        fputs("Could not authorize the prepared app's Keychain access.\n", stderr)
        exit(5)
    }
}

func drawBrand(in rect: NSRect) {
    let side = min(rect.width, rect.height)
    NSColor.black.setFill()
    NSBezierPath(roundedRect: rect, xRadius: side * 0.25, yRadius: side * 0.25).fill()
    NSColor.white.setFill()
    // Use the manager's 32-unit mark; AppKit's Y axis points up.
    func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
        NSPoint(x: rect.minX + side * x / 32, y: rect.minY + side * (32 - y) / 32)
    }
    for (left, top) in [(CGFloat(7), CGFloat(6)), (13, 14), (19, 22)] {
        let line = NSBezierPath(), bottom = top + 5
        line.move(to: point(left, top)); line.line(to: point(26, top))
        line.line(to: point(26, bottom)); line.line(to: point(left, bottom))
        line.curve(to: point(left - 2.5, top + 2.5), controlPoint1: point(left - 1.3807, bottom), controlPoint2: point(left - 2.5, top + 3.8807))
        line.curve(to: point(left, top), controlPoint1: point(left - 2.5, top + 1.1193), controlPoint2: point(left - 1.3807, top))
        line.close(); line.fill()
    }
}

// Generate the app icon from the same vector mark used in the interface.
if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--write-icon" {
    guard let size = Int(CommandLine.arguments[3]), (16...1024).contains(size),
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(2) }
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    let margin = CGFloat(size) * 0.08
    drawBrand(in: NSRect(x: margin, y: margin, width: CGFloat(size) - margin * 2, height: CGFloat(size) - margin * 2))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(3) }
    do { try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2])); exit(0) } catch { exit(4) }
}

// This executable is also the low-memory verifier used by the coordinator.
if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--verify" {
    do {
        guard let key = Data(base64Encoded: CommandLine.arguments[3]), let signature = Data(base64Encoded: CommandLine.arguments[4]) else { exit(2) }
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: key)
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]), options: .mappedIfSafe)
        guard publicKey.isValidSignature(signature, for: data) else { exit(3) }
        exit(0)
    } catch { fputs("Update signature verification failed.\n", stderr); exit(4) }
}

// A connection package opened directly takes the user to the central Library.
guard CommandLine.arguments.count == 1, let resources = Bundle.main.resourceURL else { exit(2) }
let configURL = resources.appendingPathComponent("runtime/bin/release-config.json")
guard let data = try? Data(contentsOf: configURL),
      let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let target = config["target"] as? String,
      ["codex", "t3", "antigravity", "claude", "gemini", "opencode", "zcode", "grokbot"].contains(target) else { exit(2) }
let openLibrary = Process()
openLibrary.executableURL = URL(fileURLWithPath: "/usr/bin/open")
openLibrary.arguments = ["-b", "dev.rasta.manager", "rasta://connection/" + target]
do {
    try openLibrary.run()
    openLibrary.waitUntilExit()
    exit(openLibrary.terminationStatus)
} catch { exit(1) }
