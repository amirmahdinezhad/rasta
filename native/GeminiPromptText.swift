import AppKit
import CoreText
import Observation
import SwiftUI

@_silgen_name("RastaCopySwiftUIPromptSettings")
private func copyPromptSettings(_ caller: UInt, _ attributed: UInt) -> Unmanaged<NSDictionary>?

@available(macOS 14.0, *)
@MainActor
@Observable private final class PromptTypography {
    static let shared = PromptTypography()
    var revision: UInt = 0
}

@_cdecl("RastaNotifySwiftUIPromptSettings")
public func notifySwiftUIPromptSettings() {
    if #available(macOS 26.0, *) {
        DispatchQueue.main.async {
            PromptTypography.shared.revision &+= 1
        }
    }
}

private func promptSettings(_ caller: UInt, _ attributed: UInt) -> NSDictionary? {
    guard #available(macOS 26.0, *),
          let settings = copyPromptSettings(caller, attributed)?.takeRetainedValue() else { return nil }
    // Register this read during SwiftUI's view evaluation so preference saves rebuild the prompt.
    if Thread.isMainThread {
        MainActor.assumeIsolated { _ = PromptTypography.shared.revision }
    }
    return settings
}

private func restyle(_ source: AttributedString, settings: NSDictionary) -> Text {
    guard let font = settings["font"], let spacing = settings["spacing"] as? CGFloat else { return Text(source) }
    let face = font as! CTFont
    let force = settings["force"] as? Bool ?? false
    var styled = source
    styled.swiftUI.font = Font(face)
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
        styled.swiftUI.lineHeight = .exact(points: CTFontGetSize(face) * spacing)
        let string = String(source.characters)
        let rtl = force || string.unicodeScalars.contains {
            (0x0590...0x08FF).contains($0.value) || (0xFB1D...0xFDFF).contains($0.value) || (0xFE70...0xFEFF).contains($0.value)
        }
        if rtl { styled.swiftUI.alignment = .right }
        if force { styled.foundation.writingDirection = .rightToLeft }
    }
    #endif
    return Text(styled)
}

// These entry points keep the equivalent public SwiftUI initializer's value and ownership ABI.
@_silgen_name("RastaSwiftUIPromptString")
public func swiftUIPromptString<S: StringProtocol>(_ source: S, _ caller: UInt) -> Text {
    guard let settings = promptSettings(caller, 0), settings["font"] != nil else { return Text(source) }
    return restyle(AttributedString(String(source)), settings: settings)
}

@_silgen_name("RastaSwiftUIPromptAttributed")
public func swiftUIPromptAttributed(_ source: AttributedString, _ caller: UInt) -> Text {
    guard let settings = promptSettings(caller, 1), settings["font"] != nil else { return Text(source) }
    return restyle(source, settings: settings)
}
