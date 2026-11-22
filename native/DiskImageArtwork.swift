import AppKit

// Finder uses this static, code-rendered background behind the real draggable icons.
let arguments = CommandLine.arguments
guard arguments.count == 2 else { fputs("Provide an output PNG path.\n", stderr); exit(1) }
let width = 680, height = 440
guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { exit(2) }
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
NSColor.white.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
func text(_ value: String, top: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
    (value as NSString).draw(in: NSRect(x: 35, y: CGFloat(height) - top - 42, width: 610, height: 42), withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: paragraph])
}
let ink = NSColor(srgbRed: 37/255, green: 37/255, blue: 42/255, alpha: 1)
let muted = NSColor(srgbRed: 107/255, green: 107/255, blue: 117/255, alpha: 1)
text("Install Rasta", top: 44, size: 30, weight: .semibold, color: ink)
text("Drag Rasta into Applications.", top: 91, size: 15, weight: .regular, color: muted)
let arrow = NSBezierPath(); arrow.lineWidth = 3; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
let y: CGFloat = 211
arrow.move(to: NSPoint(x: 287, y: y)); arrow.line(to: NSPoint(x: 393, y: y))
arrow.move(to: NSPoint(x: 380, y: y + 10)); arrow.line(to: NSPoint(x: 393, y: y)); arrow.line(to: NSPoint(x: 380, y: y - 10))
NSColor(srgbRed: 53/255, green: 107/255, blue: 168/255, alpha: 1).setStroke(); arrow.stroke()
text("Then open Rasta from Applications.", top: 352, size: 14, weight: .regular, color: muted)
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(3) }
do { try png.write(to: URL(fileURLWithPath: arguments[1])) } catch { fputs("Could not save the installation artwork.\n", stderr); exit(4) }
