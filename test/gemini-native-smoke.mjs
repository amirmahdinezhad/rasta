import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageGemini, commitGemini, restoreGemini, inspectGemini, verifyInstalledGemini, geminiCompatibility } from '../bin/lib/gemini-native.js';
import { discardNativeStage } from '../bin/lib/codex-native.js';
import { appFingerprint } from '../bin/lib/update-events.js';
import { hostReceipt } from '../bin/lib/host-receipt.js';
import { buildGeminiLibrary } from '../tools/build-gemini-library.mjs';

// Only this disposable fixture is executed. The installed Google app is never touched.
const root = fileURLToPath(new URL('../', import.meta.url));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-gemini-native-')));
const oldHome = process.env.ARTL_CODEX_STATE_HOME, oldTarget = process.env.ARTL_TARGET;
process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 'gemini';
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
let stage;
try {
    const app = path.join(home, 'Gemini.app'), executable = path.join(app, 'Contents/MacOS/Gemini');
    const support = path.join(home, 'Library/Application Support/Rasta Gemini'), runtime = path.join(support, 'ui-runtimes/fixture');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents/Resources'));
    fs.mkdirSync(path.join(runtime, 'bin/assets'), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    for (const name of ['Vazir-Regular.ttf', 'Vazir-Bold.ttf']) fs.copyFileSync(path.join(root, 'bin/assets', name), path.join(runtime, 'bin/assets', name));
    fs.writeFileSync(path.join(support, 'reading-preferences.json'), JSON.stringify({ fs: '18', lh: '1.8', isRTL: true, forceRTL: false, fixAtSign: true }));
    fs.symlinkSync(path.join(root, 'bin/gui-service.js'), path.join(runtime, 'bin/gui-service.js'));
    fs.writeFileSync(path.join(support, 'gui-config.json'), JSON.stringify({ app, runtime }));
    fs.writeFileSync(path.join(runtime, 'manager-preferences.mjs'), `
import fs from 'node:fs';
import { changeConnectionPreferences } from ${JSON.stringify(pathToFileURL(path.join(root, 'bin/lib/manager.js')).href)};
const options = { scan: () => [{ id: 'gemini', runtime: import.meta.dirname }] };
if (process.argv[2] === 'disable' || process.argv[2] === 'enable') {
    changeConnectionPreferences('gemini', 'reading-save', { isRTL: process.argv[2] === 'enable' }, options);
} else if (process.argv[2] === 'spacing') {
    changeConnectionPreferences('gemini', 'reading-save', { lh: '1.4' }, options);
} else {
    const data = fs.readFileSync(new URL('./bin/assets/Vazir-Bold.ttf', import.meta.url)).toString('base64');
    changeConnectionPreferences('gemini', 'font-import', { name: 'Vazir-Bold.ttf', data }, options);
    changeConnectionPreferences('gemini', 'reading-save', { fs: '14', lh: '1.4', forceRTL: false }, options);
}
`);
    const info = path.join(app, 'Contents/Info.plist');
    fs.writeFileSync(info, JSON.stringify({ CFBundleIdentifier: 'com.google.GeminiMacOS', CFBundleExecutable: 'Gemini', CFBundleShortVersionString: '1.141.3.1394', CFBundleVersion: '1.141.3.1394', CFBundlePackageType: 'APPL', NSPrincipalClass: 'NSApplication', LSUIElement: true }));
    run('/usr/bin/plutil', ['-convert', 'xml1', info]);
    const compileMessageView = (module, name, factory) => {
        const source = path.join(home, name + '.swift'), object = path.join(home, name + '.o');
        fs.writeFileSync(source, `
import AppKit

final class ${name}: NSTextView {}

@_cdecl("${factory}")
@MainActor func makeMessageView(_ textKit2: Bool) -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(${name}(usingTextLayoutManager: textKit2)).toOpaque()
}
`);
        run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-emit-object', '-module-name', module, source, '-o', object]);
        return object;
    };
    const canvasView = compileMessageView('googlemac_Janus_MacApplication_Components_Chat_Canvas_SelectableMessageContentView',
        'SelectableMessageTextView', 'makeCanvasView');
    const platformView = compileMessageView('googlemac_Janus_MacApplication_Components_Chat_ChatMessageTree_MessageContainer_Platform_PlatformTextView',
        'PlatformTextView', 'makePlatformView');
    const transcriptView = compileMessageView('googlemac_Janus_MacApplication_Components_Chat_SingleChatTranscript_SingleChatTranscript',
        'SingleChatTranscriptTextView', 'makeTranscriptView');
    const composerView = compileMessageView('googlemac_Janus_MacApplication_Components_RichInput_RichInput',
        'RichNSTextView', 'makeComposerView');
    const promptSource = path.join(home, 'FastUserMessageTextView.swift'), promptView = path.join(home, 'FastUserMessageTextView.o');
    fs.writeFileSync(promptSource, `
import AppKit
import SwiftUI

struct FastUserMessageTextView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let view = NSTextView(usingTextLayoutManager: false)
        view.isEditable = false
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 24
        paragraph.maximumLineHeight = 24
        let text = NSAttributedString(string: "First line\\nSecond line", attributes: [
            .font: NSFont.systemFont(ofSize: 12), .paragraphStyle: paragraph
        ])
        view.textStorage?.setAttributedString(text)
        scroll.documentView = view
        return scroll
    }

    func updateNSView(_ view: NSScrollView, context: Context) {}
}

@_cdecl("makePromptView")
@MainActor func makePromptView() -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(NSHostingView(rootView: FastUserMessageTextView())).toOpaque()
}
`);
    run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-emit-object', '-module-name',
        'googlemac_Janus_MacApplication_Components_Chat_UserMessageView', promptSource, '-o', promptView]);
    const fixture = path.join(home, 'fixture.m');
    fs.writeFileSync(fixture, String.raw`
#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <WebKit/WebKit.h>
extern void *makeCanvasView(BOOL textKit2);
extern void *makePlatformView(BOOL textKit2);
extern void *makeTranscriptView(BOOL textKit2);
extern void *makeComposerView(BOOL textKit2);
extern void *makePromptView(void);
@interface NSObject (RastaFixture)
- (NSEvent *)handleKeyEvent:(NSEvent *)event;
- (void)updateResponseControl:(NSView *)overlay atPoint:(NSPoint)point;
@end
@interface HostContent : NSView
@property BOOL usesFlippedCoordinates;
@property NSView *inputSurface;
@end
@implementation HostContent
- (BOOL)isFlipped { return self.usesFlippedCoordinates; }
- (NSView *)hitTest:(NSPoint)point {
    // A native host can route input to its own subtree even if it draws other views.
    return [self.inputSurface hitTest:[self convertPoint:point fromView:self.superview]];
}
@end
@interface VendorStorageDelegate : NSObject <NSTextStorageDelegate>
@property NSUInteger willEdit;
@property NSUInteger didEdit;
@end
@implementation VendorStorageDelegate
- (void)textStorage:(NSTextStorage *)storage willProcessEditing:(NSTextStorageEditActions)mask range:(NSRange)range changeInLength:(NSInteger)delta {
    self.willEdit++;
}
- (void)textStorage:(NSTextStorage *)storage didProcessEditing:(NSTextStorageEditActions)mask range:(NSRange)range changeInLength:(NSInteger)delta {
    self.didEdit++;
}
@end
static NSButton *readingButton(NSView *view) {
    if ([view.identifier isEqual:@"rasta-reading-controls"]) return (NSButton *)view;
    for (NSView *child in view.subviews) {
        NSButton *button = readingButton(child);
        if (button) return button;
    }
    return nil;
}
static BOOL buttonAtBottomRight(NSButton *button, NSView *content) {
    [content.superview layoutSubtreeIfNeeded];
    NSRect frame = [button convertRect:button.bounds toView:content], bounds = content.bounds;
    CGFloat bottom = content.isFlipped ? NSMaxY(bounds) - NSMaxY(frame) : NSMinY(frame) - NSMinY(bounds);
    return fabs(NSMaxX(bounds) - NSMaxX(frame) - 16) < 0.5 && fabs(bottom - 16) < 0.5
        && frame.size.width == 28 && frame.size.height == 28;
}
static NSPoint buttonCenter(NSButton *button) {
    return [button convertPoint:NSMakePoint(NSMidX(button.bounds), NSMidY(button.bounds)) toView:nil];
}
static NSView *windowHit(NSWindow *window, NSPoint point) {
    NSView *frame = window.contentView.superview;
    return [frame hitTest:frame.superview ? [frame.superview convertPoint:point fromView:nil] : point];
}
static id webValue(WKWebView *web, NSString *script) {
    __block BOOL done = NO;
    __block id result = nil;
    [web evaluateJavaScript:script completionHandler:^(id value, NSError *error) {
        if (error) fprintf(stderr, "%s\n", error.description.UTF8String);
        result = value;
        done = YES;
    }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
    while (!done && [deadline timeIntervalSinceNow] > 0)
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    return result;
}
static void moveOverWebView(WKWebView *web, NSPoint point) {
    if (!web.isFlipped) point.y = NSHeight(web.bounds) - point.y;
    [NSApp sendEvent:[NSEvent mouseEventWithType:NSEventTypeMouseMoved
        location:[web convertPoint:point toView:nil] modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
        windowNumber:web.window.windowNumber context:nil eventNumber:0 clickCount:0 pressure:0]];
}
static BOOL panelShowsReadingSwitches(WKWebView *web, BOOL enabled) {
    NSString *script = [NSString stringWithFormat:
        @"(() => { const switches = [...document.querySelector('#panel').shadowRoot.querySelectorAll('[role=switch]')];"
        " return switches.length === 3 && switches[0].getAttribute('aria-checked') === '%@'"
        " && switches.slice(1).every(control => control.disabled === %@ && control.getAttribute('aria-checked') === 'true'); })()",
        enabled ? @"true" : @"false", enabled ? @"false" : @"true"];
    for (NSUInteger attempt = 0; attempt < 30; attempt++) {
        if ([webValue(web, script) boolValue]) return YES;
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
    }
    return NO;
}
static void checkCloseHover(WKWebView *web) {
    NSString *setup = @"window.closeButton = document.querySelector('#panel').shadowRoot.querySelector('[data-slot=dialog-close]');"
        "closeButton.focus(); closeButton.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift', bubbles:true}));"
        "const rect = closeButton.getBoundingClientRect(); [rect.x + rect.width / 2, rect.y + rect.height / 2]";
    NSArray *center = webValue(web, setup);
    if (center.count != 2) { fputs("Could not find the native panel Close button.\n", stderr); exit(11); }
    NSString *fill = @"getComputedStyle(closeButton).backgroundColor";
    moveOverWebView(web, NSMakePoint(1, 1));
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.22]];
    id rest = webValue(web, fill);
    moveOverWebView(web, NSMakePoint([center[0] doubleValue], [center[1] doubleValue]));
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.22]];
    id hover = webValue(web, fill);
    BOOL pointerOverClose = [webValue(web, @"closeButton.hasAttribute('data-native-hover')") boolValue];
    moveOverWebView(web, NSMakePoint(1, 1));
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.22]];
    BOOL pointerLeftClose = ![webValue(web, @"closeButton.hasAttribute('data-native-hover')") boolValue];
    id after = webValue(web, fill);
    if (!pointerOverClose || !pointerLeftClose || !rest || !hover || [hover isEqual:rest] || ![after isEqual:rest]) {
        fprintf(stderr, "The native Close fill did not follow pointer entry and exit: %s / %s / %s (entered=%d, left=%d).\n",
            [rest description].UTF8String, [hover description].UTF8String, [after description].UTF8String, pointerOverClose, pointerLeftClose);
        exit(11);
    }
}
static void clickButton(NSButton *button) {
    NSView *hit = windowHit(button.window, buttonCenter(button));
    if (hit == button) [button performClick:nil];
}
static NSBitmapImageRep *renderButton(NSButton *button) {
    NSBitmapImageRep *image = [button bitmapImageRepForCachingDisplayInRect:button.bounds];
    [button cacheDisplayInRect:button.bounds toBitmapImageRep:image];
    return image;
}
static CGFloat buttonGray(NSBitmapImageRep *image, NSInteger x, NSInteger y) {
    NSColor *color = [image colorAtX:x * image.pixelsWide / 28 y:y * image.pixelsHigh / 28];
    return [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace].redComponent;
}
static NSDictionary *reading(void) {
    NSString *sample = [NSString stringWithFormat:@"%C%C%C%C", 0x633, 0x644, 0x627, 0x645];
    NSAttributedString *source = [[NSAttributedString alloc] initWithString:sample attributes:@{NSFontAttributeName: [NSFont systemFontOfSize:14]}];
    CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)source);
    CFArrayRef runs = CTLineGetGlyphRuns(line);
    CFDictionaryRef attrs = CTRunGetAttributes(CFArrayGetValueAtIndex(runs, 0));
    CTFontRef font = CFDictionaryGetValue(attrs, kCTFontAttributeName);
    NSParagraphStyle *paragraph = (__bridge id)CFDictionaryGetValue(attrs, kCTParagraphStyleAttributeName);
    NSDictionary *value = @{@"font": CFBridgingRelease(CTFontCopyFamilyName(font)), @"size": @(CTFontGetSize(font)), @"rtl": @((BOOL)(paragraph.baseWritingDirection == NSWritingDirectionRightToLeft))};
    CFRelease(line); return value;
}
static NSDictionary *messageStyle(NSTextView *view, NSUInteger offset) {
    NSDictionary *attributes = [view.textStorage attributesAtIndex:offset effectiveRange:NULL];
    CTFontRef font = (__bridge CTFontRef)attributes[NSFontAttributeName];
    NSParagraphStyle *paragraph = attributes[NSParagraphStyleAttributeName];
    return @{@"font": CFBridgingRelease(CTFontCopyPostScriptName(font)), @"size": @(CTFontGetSize(font)),
        @"gap": @(round(paragraph.lineSpacing * 10) / 10), @"rtl": @((BOOL)(paragraph.baseWritingDirection == NSWritingDirectionRightToLeft))};
}
static NSArray *paragraphGeometry(NSTextView *view, NSUInteger offset) {
    NSParagraphStyle *style = [view.textStorage attribute:NSParagraphStyleAttributeName atIndex:offset effectiveRange:NULL];
    return @[@(style.alignment), @(style.headIndent), @(style.tailIndent), @(style.paragraphSpacing)];
}
static NSTextView *findTextView(NSView *view) {
    if ([view isKindOfClass:NSTextView.class]) return (NSTextView *)view;
    for (NSView *child in view.subviews) {
        NSTextView *found = findTextView(child);
        if (found) return found;
    }
    return nil;
}
static CGFloat lineAdvance(NSTextView *view, CGFloat *rightEdgeDifference) {
    __block NSUInteger count = 0;
    __block struct { NSPoint values[2]; } positions;
    NSTextLayoutManager *modern = view.textLayoutManager;
    if (modern) {
        [modern ensureLayoutForRange:modern.documentRange];
        [modern enumerateTextLayoutFragmentsFromLocation:nil options:NSTextLayoutFragmentEnumerationOptionsEnsuresLayout
            usingBlock:^BOOL(NSTextLayoutFragment *fragment) {
                for (NSTextLineFragment *line in fragment.textLineFragments) {
                    positions.values[count++] = NSMakePoint(NSMinX(fragment.layoutFragmentFrame) + NSMaxX(line.typographicBounds),
                        NSMinY(fragment.layoutFragmentFrame) + NSMinY(line.typographicBounds));
                    if (count == 2) return NO;
                }
                return YES;
            }];
    } else {
        NSLayoutManager *layout = view.layoutManager;
        NSTextContainer *container = view.textContainer;
        [layout ensureLayoutForTextContainer:container];
        [layout enumerateLineFragmentsForGlyphRange:[layout glyphRangeForTextContainer:container]
            usingBlock:^(NSRect rect, NSRect used, NSTextContainer *owner, NSRange range, BOOL *stop) {
                positions.values[count++] = NSMakePoint(NSMaxX(used), NSMinY(rect));
                *stop = count == 2;
            }];
    }
    if (rightEdgeDifference) *rightEdgeDifference = count == 2 ? fabs(positions.values[1].x - positions.values[0].x) : CGFLOAT_MAX;
    return count == 2 ? positions.values[1].y - positions.values[0].y : 0;
}
static void changeManagerPreferences(NSString *action) {
    NSString *runtime = NSProcessInfo.processInfo.environment[@"RASTA_FIXTURE_RUNTIME"];
    NSTask *task = [NSTask new];
    task.executableURL = [NSURL fileURLWithPath:[runtime stringByAppendingPathComponent:@"node"]];
    task.arguments = @[[runtime stringByAppendingPathComponent:@"manager-preferences.mjs"], action];
    [task launch];
    [task waitUntilExit];
    if (task.terminationStatus != 0) exit(8);
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc == 42) CFRelease(CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)[[NSAttributedString alloc] initWithString:@"unused"]));
        [NSApplication sharedApplication];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 640, 480) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        BOOL flipped = [NSProcessInfo.processInfo.environment[@"RASTA_FIXTURE_FLIPPED"] boolValue];
        if (flipped) window.styleMask |= NSWindowStyleMaskFullSizeContentView;
        HostContent *content = [[HostContent alloc] initWithFrame:window.contentView.frame];
        content.usesFlippedCoordinates = flipped;
        if (flipped) content.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
        content.inputSurface = [[NSView alloc] initWithFrame:content.bounds];
        content.inputSurface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        [content addSubview:content.inputSurface];
        NSTextView *message = (__bridge_transfer NSTextView *)(flipped ? makePlatformView(YES) : makeCanvasView(NO));
        message.frame = NSMakeRect(170, 150, 240, 120);
        message.editable = NO;
        message.selectable = YES;
        NSString *sample = [NSString stringWithFormat:@"%C%C%C%C\ncode\nEnglish", 0x633, 0x644, 0x627, 0x645];
        NSFont *originalFont = [NSFont systemFontOfSize:12];
        NSMutableAttributedString *original = [[NSMutableAttributedString alloc] initWithString:sample attributes:@{NSFontAttributeName: originalFont}];
        [original addAttribute:NSFontAttributeName value:[NSFont monospacedSystemFontOfSize:11 weight:NSFontWeightRegular] range:NSMakeRange(5, 4)];
        NSURL *link = [NSURL URLWithString:@"https://example.test"];
        [original addAttribute:NSLinkAttributeName value:link range:NSMakeRange(0, 2)];
        [message.textStorage setAttributedString:original];
        NSDictionary *originalMessage = messageStyle(message, 0);
        NSDictionary *originalEnglish = messageStyle(message, 10);
        message.selectedRange = NSMakeRange(1, 2);
        NSView *surface = content.inputSurface;
        [surface addSubview:message];
        NSView *promptHost = (__bridge_transfer NSView *)makePromptView();
        promptHost.frame = NSMakeRect(0, 180, 150, 100);
        [surface addSubview:promptHost];
        NSTextView *ordinaryText = [[NSTextView alloc] initWithFrame:NSMakeRect(170, 280, 240, 100)];
        ordinaryText.editable = NO;
        [ordinaryText.textStorage setAttributedString:original];
        [surface addSubview:ordinaryText];
        NSTextView *composer = (__bridge_transfer NSTextView *)makeComposerView(flipped);
        composer.frame = NSMakeRect(10, 10, 135, 100);
        composer.editable = YES;
        composer.richText = YES;
        [surface addSubview:composer];
        window.contentView = content;
        window.appearance = [NSAppearance appearanceNamed:flipped ? NSAppearanceNameAqua : NSAppearanceNameDarkAqua];
        window.title = @"Rasta isolated native fixture"; [window makeKeyAndOrderFront:nil];
        NSWindow *settings = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 420, 320) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        settings.title = @"Appearance";
        [settings.contentView addSubview:[[NSTextView alloc] initWithFrame:NSMakeRect(10, 10, 200, 80)]];
        [settings orderWindow:NSWindowBelow relativeTo:window.windowNumber];
        __block BOOL checked = NO;
        [NSTimer scheduledTimerWithTimeInterval:0.25 repeats:YES block:^(NSTimer *timer) {
            if (checked) return;
            NSButton *button = readingButton(window.contentView.superview);
            if (!button) return;
            id host = button.target;
            if (readingButton(settings.contentView.superview)) {
                fputs("The settings window received a launcher.\n", stderr); exit(9);
            }
            if (![[host valueForKey:@"pageReady"] boolValue] || ![[host valueForKey:@"sentReady"] boolValue]) return;
            checked = YES; [timer invalidate];
            [settings orderOut:nil];
            BOOL initialPosition = buttonAtBottomRight(button, window.contentView);
            [window setContentSize:NSMakeSize(820, 620)];
            BOOL resizedPosition = buttonAtBottomRight(button, window.contentView);
            [window setContentSize:NSMakeSize(480, 360)];
            BOOL smallerPosition = buttonAtBottomRight(button, window.contentView);
            BOOL hostHit = windowHit(window, [content convertPoint:NSMakePoint(450, 120) toView:nil]) == content.inputSurface;
            if (windowHit(window, buttonCenter(button)) != button) {
                fputs("The native host received the launcher hit.\n", stderr); exit(6);
            }
            [window makeKeyAndOrderFront:nil];
            NSTextView *directionsTranscript = (__bridge_transfer NSTextView *)makeTranscriptView(flipped);
            directionsTranscript.editable = NO;
            directionsTranscript.selectable = YES;
            directionsTranscript.verticallyResizable = NO;
            NSString *rtlSample = [sample substringToIndex:4];
            NSString *turn = [NSString stringWithFormat:@"%@\n%@\n%@\n", rtlSample, rtlSample, rtlSample];
            NSMutableAttributedString *turns = [[NSMutableAttributedString alloc] initWithString:[turn stringByAppendingString:turn]
                attributes:@{NSFontAttributeName: originalFont}];
            for (NSUInteger start = 0; start < turns.length; start += turn.length) {
                [turns addAttribute:@"JanusUserPromptBubble" value:@(start) range:NSMakeRange(start, rtlSample.length + 1)];
            }
            [directionsTranscript.textStorage setAttributedString:turns];
            directionsTranscript.frame = NSMakeRect(245, 25, 190, 205);
            [surface addSubview:directionsTranscript];
            NSUInteger firstResponseOffset = rtlSample.length + 1;
            CGFloat advance = lineAdvance(directionsTranscript, NULL);
            NSPoint localResponsePoint = NSMakePoint(175, advance + directionsTranscript.textContainerOrigin.y + 6);
            NSPoint responsePoint = [directionsTranscript convertPoint:localResponsePoint toView:nil];
            NSButton *direction = nil;
            for (NSView *control in button.superview.subviews) {
                if ([control.identifier isEqual:@"rasta-message-direction"]) direction = (NSButton *)control;
            }
            if (!direction || !direction.hidden) { fputs("Response control visible at rest.\n", stderr); exit(10); }
            [host updateResponseControl:button.superview atPoint:responsePoint];
            if (!direction || direction.hidden || ![direction.toolTip isEqual:@"Switch to left-to-right text"]
                || windowHit(window, buttonCenter(direction)) != direction) {
                fprintf(stderr, "Response control hit failed: key=%d hidden=%d label=%s hit=%d point=%s frame=%s view=%s\n",
                    window.isKeyWindow, direction.hidden, direction.toolTip.UTF8String,
                    windowHit(window, buttonCenter(direction)) == direction, NSStringFromPoint(responsePoint).UTF8String,
                    NSStringFromRect(direction.frame).UTF8String, NSStringFromRect(directionsTranscript.frame).UTF8String);
                fprintf(stderr, "Character index %lu, expected %lu, line advance %.2f\n",
                    [directionsTranscript characterIndexForInsertionAtPoint:localResponsePoint], firstResponseOffset, advance);
                exit(10);
            }
            NSRect responseFrame = [direction.superview convertRect:directionsTranscript.bounds fromView:directionsTranscript];
            if (NSMaxX(direction.frame) > NSMidX(responseFrame) || windowHit(window, responsePoint) != directionsTranscript) {
                fprintf(stderr, "The direction button covers the right-aligned response: frame=%s hit=%s.\\n",
                    NSStringFromRect(direction.frame).UTF8String, NSStringFromClass([windowHit(window, responsePoint) class]).UTF8String);
                exit(10);
            }
            NSRect initialDirectionFrame = direction.frame;
            NSPoint nextLine = NSMakePoint(localResponsePoint.x, localResponsePoint.y + advance);
            [host updateResponseControl:direction.superview atPoint:[directionsTranscript convertPoint:nextLine toView:nil]];
            if (direction.hidden || !NSEqualRects(direction.frame, initialDirectionFrame)) {
                fputs("The direction button moved between lines of the same response.\n", stderr); exit(10);
            }
            [host updateResponseControl:direction.superview atPoint:buttonCenter(direction)];
            if (direction.hidden) { fputs("Moving from the response onto its control hides it.\\n", stderr); exit(10); }
            clickButton(direction);
            if ([paragraphGeometry(directionsTranscript, firstResponseOffset)[0] intValue] != NSTextAlignmentLeft
                || [paragraphGeometry(directionsTranscript, 0)[0] intValue] != NSTextAlignmentRight
                || [paragraphGeometry(directionsTranscript, turn.length + firstResponseOffset)[0] intValue] != NSTextAlignmentRight
                || ![directionsTranscript.string isEqualToString:turns.string]) {
                fputs("The direction control did not isolate the selected response.\n", stderr); exit(10);
            }
            [host updateResponseControl:button.superview atPoint:responsePoint];
            if (direction.hidden || ![direction.toolTip isEqual:@"Switch to right-to-left text"]) {
                fputs("The direction control did not follow the response after switching to left-to-right.\\n", stderr); exit(10);
            }
            [window makeFirstResponder:direction];
            [host updateResponseControl:button.superview atPoint:[content convertPoint:NSMakePoint(450, 120) toView:nil]];
            if (!direction.hidden) { fputs("Response control remained visible outside the response.\n", stderr); exit(10); }
            [host updateResponseControl:button.superview atPoint:responsePoint];
            if (direction.hidden || ![direction.toolTip isEqual:@"Switch to right-to-left text"]) {
                fputs("The direction control did not return after reentering the response.\\n", stderr); exit(10);
            }
            clickButton(direction);
            if ([paragraphGeometry(directionsTranscript, firstResponseOffset)[0] intValue] != NSTextAlignmentRight) {
                fputs("The direction control could not switch back to right-to-left.\\n", stderr); exit(10);
            }
            [host updateResponseControl:button.superview atPoint:responsePoint];
            clickButton(direction);
            if ([paragraphGeometry(directionsTranscript, firstResponseOffset)[0] intValue] != NSTextAlignmentLeft) {
                fputs("The direction control could not switch back to left-to-right.\\n", stderr); exit(10);
            }
            NSRect originalResponseFrame = directionsTranscript.frame;
            [directionsTranscript setFrameSize:NSMakeSize(54, NSHeight(originalResponseFrame))];
            CGFloat compactLineAdvance = lineAdvance(directionsTranscript, NULL);
            NSPoint compactPoint = NSMakePoint(20, compactLineAdvance + directionsTranscript.textContainerOrigin.y + 6);
            NSUInteger compactIndex = [directionsTranscript characterIndexForInsertionAtPoint:compactPoint];
            [host updateResponseControl:direction.superview atPoint:[directionsTranscript convertPoint:compactPoint toView:nil]];
            if (!NSLocationInRange(compactIndex, NSMakeRange(firstResponseOffset, rtlSample.length)) || !direction.hidden) {
                fputs("The direction button is visible when the response occupies both edges.\\n", stderr); exit(10);
            }
            directionsTranscript.frame = originalResponseFrame;
            [window makeFirstResponder:nil];
            [button updateTrackingAreas];
            NSTrackingArea *hoverArea = [button valueForKey:@"hoverArea"];
            NSBitmapImageRep *rest = renderButton(button);
            NSEvent *enter = [NSEvent enterExitEventWithType:NSEventTypeMouseEntered location:buttonCenter(button) modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 trackingNumber:0 userData:NULL];
            [hoverArea.owner mouseEntered:enter];
            CGFloat hover = buttonGray(renderButton(button), 14, 2);
            WKWebView *web = [host valueForKey:@"web"];
            NSUInteger windowsBefore = NSApp.windows.count;
            window.acceptsMouseMovedEvents = flipped;
            BOOL hostAcceptedMouseMoves = window.acceptsMouseMovedEvents;
            clickButton(button);
            if (!web.superview) { fputs("Clicking the launcher did not open the native panel.\n", stderr); exit(7); }
            NSEvent *leave = [NSEvent enterExitEventWithType:NSEventTypeMouseExited location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 trackingNumber:0 userData:NULL];
            [hoverArea.owner mouseExited:leave];
            CGFloat expanded = buttonGray(renderButton(button), 14, 2);
            [web evaluateJavaScript:@" 'opened'" completionHandler:^(id value, NSError *error) {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                    checkCloseHover(web);
                    [web evaluateJavaScript:@"JSON.stringify({panel:!!document.querySelector('#panel').shadowRoot.querySelector('[role=dialog]'),switches:document.querySelector('#panel').shadowRoot.querySelectorAll('[role=switch]').length,sections:Array.from(document.querySelector('#panel').shadowRoot.querySelectorAll('[data-slot=accordion-trigger]'), e=>e.textContent.trim())})" completionHandler:^(id value, NSError *error) {
                        if (error) { fprintf(stderr, "%s\n", error.description.UTF8String); exit(4); }
                        NSMutableDictionary *result = [[NSJSONSerialization JSONObjectWithData:[value dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] mutableCopy];
                        result[@"reading"] = reading(); result[@"button"] = button.identifier;
                        result[@"initialMessage"] = messageStyle(message, 0);
                        NSTextView *prompt = findTextView(promptHost);
                        if (!prompt) { fputs("The SwiftUI message view did not mount.\n", stderr); exit(9); }
                        result[@"initialPrompt"] = messageStyle(prompt, 0);
                        NSString *rtlWord = [sample substringToIndex:4];
                        NSString *rtlLines = [NSString stringWithFormat:@"%@ %@\n%@", rtlWord, rtlWord, rtlWord];
                        NSTextView *transcript = (__bridge_transfer NSTextView *)makeTranscriptView(flipped);
                        transcript.frame = NSMakeRect(0, 0, 145, 90);
                        transcript.editable = NO;
                        NSFont *promptFace = [NSFontManager.sharedFontManager convertFont:originalFont toHaveTrait:NSItalicFontMask];
                        NSMutableParagraphStyle *bubble = [NSMutableParagraphStyle new];
                        bubble.alignment = NSTextAlignmentLeft;
                        bubble.baseWritingDirection = NSWritingDirectionLeftToRight;
                        bubble.headIndent = bubble.firstLineHeadIndent = 40;
                        bubble.tailIndent = -12;
                        [transcript.textStorage setAttributedString:[[NSAttributedString alloc] initWithString:rtlLines attributes:@{
                            NSFontAttributeName: promptFace, NSParagraphStyleAttributeName: bubble, @"JanusUserPromptBubble": @"Fixture bubble"
                        }]];
                        [surface addSubview:transcript];
                        result[@"transcriptPrompt"] = messageStyle(transcript, 0);
                        result[@"transcriptGeometry"] = paragraphGeometry(transcript, 0);
                        result[@"transcriptEndGeometry"] = paragraphGeometry(transcript, transcript.string.length - 1);
                        [window makeFirstResponder:composer];
                        NSString *draftText = [@[rtlWord, rtlWord, rtlWord, rtlWord, rtlWord] componentsJoinedByString:@" "];
                        [composer insertText:draftText replacementRange:NSMakeRange(0, 0)];
                        result[@"draft"] = messageStyle(composer, composer.string.length - 1);
                        result[@"draftGeometry"] = paragraphGeometry(composer, composer.string.length - 1);
                        CGFloat draftRightEdge, promptRightEdge;
                        lineAdvance(composer, &draftRightEdge);
                        lineAdvance(transcript, &promptRightEdge);
                        result[@"rightEdgeDifference"] = @[@(draftRightEdge), @(promptRightEdge)];
                        result[@"draftTextAndCaret"] = @((BOOL)([composer.string isEqualToString:draftText] &&
                            NSEqualRanges(composer.selectedRange, NSMakeRange(draftText.length, 0))));
                        NSTextView *response = (__bridge_transfer NSTextView *)(flipped ? makePlatformView(YES) : makeCanvasView(NO));
                        response.editable = NO;
                        response.frame = NSMakeRect(0, 0, 145, 90);
                        VendorStorageDelegate *vendor = [VendorStorageDelegate new];
                        response.textStorage.delegate = vendor;
                        NSMutableParagraphStyle *fixedHeight = [NSMutableParagraphStyle new];
                        fixedHeight.minimumLineHeight = 24;
                        fixedHeight.maximumLineHeight = 24;
                        NSAttributedString *firstResponse = [[NSAttributedString alloc]
                            initWithString:[NSString stringWithFormat:@"%@\n%@", [sample substringToIndex:4], [sample substringToIndex:4]]
                            attributes:@{NSFontAttributeName: originalFont, NSParagraphStyleAttributeName: fixedHeight}];
                        void (^renderResponse)(void) = ^{ [response.textStorage setAttributedString:firstResponse]; };
                        if (response.textContentStorage) [response.textContentStorage performEditingTransactionUsingBlock:renderResponse];
                        else renderResponse();
                        [surface addSubview:response];
                        result[@"firstFrame"] = messageStyle(response, 0);
                        NSUInteger willBefore = vendor.willEdit, didBefore = vendor.didEdit;
                        void (^streamResponse)(void) = ^{
                            NSMutableAttributedString *next = [firstResponse mutableCopy];
                            [next appendAttributedString:[[NSAttributedString alloc]
                                initWithString:@" continued" attributes:@{NSFontAttributeName: originalFont, NSParagraphStyleAttributeName: fixedHeight}]];
                            [response.textStorage setAttributedString:next];
                        };
                        if (response.textContentStorage) [response.textContentStorage performEditingTransactionUsingBlock:streamResponse];
                        else streamResponse();
                        result[@"streamFrame"] = messageStyle(response, 0);
                        result[@"streamNewRun"] = messageStyle(response, response.string.length - 1);
                        result[@"vendorNotified"] = @((BOOL)(vendor.willEdit > willBefore && vendor.didEdit > didBefore));
                        VendorStorageDelegate *replacement = [VendorStorageDelegate new];
                        response.textStorage.delegate = replacement;
                        if (response.textContentStorage) [response.textContentStorage performEditingTransactionUsingBlock:renderResponse];
                        else renderResponse();
                        composer.textStorage.delegate = replacement;
                        [composer.textStorage setAttributedString:[[NSAttributedString alloc]
                            initWithString:rtlWord attributes:@{NSFontAttributeName: originalFont}]];
                        [host performSelector:NSSelectorFromString(@"refresh")];
                        result[@"reboundResponse"] = messageStyle(response, 0);
                        result[@"reboundDraft"] = messageStyle(composer, 0);
                        if (response.textContentStorage) [response.textContentStorage performEditingTransactionUsingBlock:streamResponse];
                        else streamResponse();
                        result[@"textKit2"] = @((BOOL)(message.textLayoutManager != nil));
                        result[@"ordinaryUnchanged"] = @([ordinaryText.textStorage isEqualToAttributedString:original]);
                        result[@"englishBeforeForce"] = messageStyle(message, 10);
                        result[@"placement"] = @{@"initial": @(initialPosition), @"larger": @(resizedPosition), @"smaller": @(smallerPosition), @"flipped": @(flipped)};
                        result[@"inWindow"] = @((BOOL)(web.window == window && window.contentView == content));
                        result[@"hostHit"] = @(hostHit);
                        result[@"launcherOnTop"] = @((BOOL)(windowHit(window, buttonCenter(button)) == button));
                        CGFloat darkest = 1, brightest = 0;
                        for (NSInteger x = 7; x < 21; x++) {
                            for (NSInteger y = 7; y < 21; y++) {
                                CGFloat gray = buttonGray(rest, x, y);
                                darkest = MIN(darkest, gray);
                                brightest = MAX(brightest, gray);
                            }
                        }
                        result[@"appearance"] = @{
                            @"noBorder": @((BOOL)(fabs(buttonGray(rest, 14, 1) - buttonGray(rest, 14, 3)) < 0.03)),
                            @"glyph": @((BOOL)(brightest - darkest > 0.35)),
                            @"hoverAndExpanded": @((BOOL)(buttonGray(rest, 14, 2) < hover && hover < expanded)),
                        };
                        result[@"extraWindows"] = @((NSInteger)NSApp.windows.count - (NSInteger)windowsBefore);
                        result[@"titlebarButtons"] = @(window.titlebarAccessoryViewControllers.count);
                        NSTextView *editor = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 300, 120)];
                        [content.inputSurface addSubview:editor]; [window makeFirstResponder:editor];
                        NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:NSEventModifierFlagShift timestamp:0 windowNumber:window.windowNumber context:nil characters:@"\"" charactersIgnoringModifiers:@"2" isARepeat:NO keyCode:19];
                        BOOL consumed = [host handleKeyEvent:key] == nil;
                        result[@"shortcut"] = @((BOOL)(consumed && [editor.string isEqual:@"@"]));
                        [editor setFieldEditor:YES]; editor.string = @"";
                        result[@"fieldEditorPreserved"] = @((BOOL)([host handleKeyEvent:key] == key && editor.string.length == 0));
                        [web callAsyncJavaScript:
                            @"const root = document.querySelector('#panel').shadowRoot;"
                            @"const wait = async (check) => { for (let n = 0; n < 150; n++) {"
                            @"  const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20));"
                            @"} throw Error('Timed out waiting for the Rasta panel'); };"
                            @"const control = root.querySelectorAll('[role=switch]')[1]; control.click();"
                            @"await wait(() => control.getAttribute('aria-checked') === 'true' && !control.hasAttribute('aria-disabled'));"
                            @"const rpc = window.webkit.messageHandlers.rasta;"
                            @"const {reading} = await rpc.postMessage({action:'preferences'});"
                            @"Array.from(root.querySelectorAll('[data-slot=accordion-trigger]')).find(el => el.textContent.trim() === 'Typography').click();"
                            @"const trigger = root.querySelector('#text-size');"
                            @"const enter = () => new KeyboardEvent('keydown', {key:'Enter', bubbles:true, composed:true, cancelable:true});"
                            @"trigger.dispatchEvent(enter());"
                            @"const list = await wait(() => root.querySelector('[role=listbox]'));"
                            @"const selectShadow = getComputedStyle(list).boxShadow;"
                            @"Array.from(list.querySelectorAll('[role=option]')).find(el => el.textContent.trim() === '16 px').dispatchEvent(enter());"
                            @"await wait(() => trigger.textContent.includes('16 px') && !trigger.hasAttribute('aria-disabled'));"
                            @"const typography = (await rpc.postMessage({action:'preferences'})).reading;"
                            @"return { reading, typography, selectShadow, reopenNote: root.querySelector('[role=dialog]').textContent.includes('Reopen Gemini') };"
                            arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id saved, NSError *error) {
                                if (error) { fprintf(stderr, "%s\n", error.description.UTF8String); exit(5); }
                                result[@"saved"] = saved ?: @NO;
                                result[@"updatedReading"] = reading();
                                result[@"updatedMessage"] = messageStyle(message, 0);
                                if (response.textContentStorage) [response.textContentStorage performEditingTransactionUsingBlock:renderResponse];
                                else renderResponse();
                                result[@"streamAfterSave"] = messageStyle(response, 0);
                                result[@"spaciousAdvance"] = @[@(lineAdvance(prompt, NULL)), @(lineAdvance(response, NULL))];
                                result[@"forcedEnglish"] = messageStyle(message, 10);
                                result[@"forcedResponseAlignment"] = @((BOOL)([paragraphGeometry(directionsTranscript, firstResponseOffset)[0] intValue] == NSTextAlignmentRight));
                                webValue(web, @"[...document.querySelector('#panel').shadowRoot.querySelectorAll('[data-slot=accordion-trigger]')]"
                                    ".find(el => el.textContent.trim() === 'Reading').click()");
                                [editor setFieldEditor:NO]; editor.string = @"";
                                [window makeFirstResponder:editor];
                                changeManagerPreferences(@"disable");
                                [host performSelector:NSSelectorFromString(@"refresh")];
                                result[@"masterDisabled"] = @((BOOL)([host handleKeyEvent:key] == key && editor.string.length == 0
                                    && [messageStyle(message, 10) isEqual:originalEnglish] && panelShowsReadingSwitches(web, NO)));
                                changeManagerPreferences(@"enable");
                                [host performSelector:NSSelectorFromString(@"refresh")];
                                result[@"masterRestored"] = @((BOOL)([host handleKeyEvent:key] == nil && [editor.string isEqual:@"@"]
                                    && [messageStyle(message, 10)[@"rtl"] boolValue] && panelShowsReadingSwitches(web, YES)));
                                result[@"code"] = messageStyle(message, 5);
                                result[@"linkAndSelection"] = @((BOOL)([[message.textStorage attribute:NSLinkAttributeName atIndex:0 effectiveRange:NULL] isEqual:link]
                                    && NSEqualRanges(message.selectedRange, NSMakeRange(1, 2))));
                                [message.textStorage replaceCharactersInRange:NSMakeRange(4, 0) withString:[sample substringToIndex:1]];
                                [message.textStorage addAttribute:NSForegroundColorAttributeName value:NSColor.blueColor range:NSMakeRange(0, 1)];
                                changeManagerPreferences(@"spacing");
                                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC + NSEC_PER_SEC / 4), dispatch_get_main_queue(), ^{
                                    result[@"compactAdvance"] = @[@(lineAdvance(prompt, NULL)), @(lineAdvance(response, NULL))];
                                    changeManagerPreferences(@"change");
                                });
                                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC + NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{
                                    result[@"managerMessage"] = messageStyle(message, 4);
                                    result[@"managerPrompt"] = messageStyle(prompt, 0);
                                    result[@"managerDraft"] = messageStyle(composer, 0);
                                    result[@"managerTranscript"] = messageStyle(transcript, 0);
                                    result[@"englishAfterForce"] = messageStyle(message, 11);
                                    result[@"restoredResponseAlignment"] = @((BOOL)([paragraphGeometry(directionsTranscript, firstResponseOffset)[0] intValue] == NSTextAlignmentLeft));
                                    changeManagerPreferences(@"disable");
                                    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC + NSEC_PER_SEC / 4), dispatch_get_main_queue(), ^{
                                        result[@"restoredMessage"] = @([messageStyle(message, 0) isEqual:originalMessage]);
                                        result[@"streamedContent"] = @((BOOL)(message.string.length == sample.length + 1
                                            && [[message.textStorage attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:NULL] isEqual:NSColor.blueColor]));
                                        [web evaluateJavaScript:@"document.querySelector('#panel').shadowRoot.querySelector('[data-slot=dialog-close]').click()" completionHandler:nil];
                                        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{
                                            result[@"dismissed"] = @((BOOL)(web.superview == nil));
                                            result[@"focusRestored"] = @((BOOL)(window.firstResponder == button));
                                            if (window.acceptsMouseMovedEvents != hostAcceptedMouseMoves) {
                                                fputs("The panel did not restore the host window's mouse-move setting.\n", stderr); exit(11);
                                            }
                                            clickButton(button);
                                            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{
                                                [web evaluateJavaScript:@"!!document.querySelector('#panel').shadowRoot.querySelector('[role=dialog]')" completionHandler:^(id reopened, NSError *error) {
                                                    result[@"reopened"] = reopened ?: @NO;
                                                    clickButton(button);
                                                    result[@"closedByLauncher"] = @((BOOL)(web.superview == nil));
                                                    clickButton(button);
                                                    composer.hidden = YES;
                                                    [host performSelector:NSSelectorFromString(@"refresh")];
                                                    result[@"hiddenOutsideChat"] = @((BOOL)(readingButton(window.contentView.superview) == nil && web.superview == nil));
                                                    composer.hidden = NO;
                                                    [host performSelector:NSSelectorFromString(@"refresh")];
                                                    result[@"restoredInChat"] = @((BOOL)(readingButton(window.contentView.superview) != nil));
                                                    puts([[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL] encoding:NSUTF8StringEncoding].UTF8String);
                                                    fflush(stdout); [NSApp terminate:nil];
                                                }];
                                            });
                                        });
                                    });
                                });
                            }];
                    }];
                });
            }];
        }];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            id host = readingButton(window.contentView.superview).target;
            fprintf(stderr, "Native fixture startup timed out: accessories=%lu page=%d ready=%d error=%s\n", (unsigned long)window.titlebarAccessoryViewControllers.count, [[host valueForKey:@"pageReady"] boolValue], [[host valueForKey:@"sentReady"] boolValue], [[host valueForKey:@"pageError"] UTF8String]); exit(3);
        });
        [NSApp run];
    }
}
`);
    const fixtureObject = path.join(home, 'fixture.o');
    run('/usr/bin/xcrun', ['clang', '-fobjc-arc', '-O0', '-c', fixture, '-o', fixtureObject]);
    run('/usr/bin/xcrun', ['swiftc', '-framework', 'AppKit', '-framework', 'CoreText', '-framework', 'WebKit',
        fixtureObject, canvasView, platformView, transcriptView, composerView, promptView, '-o', executable]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', app]);
    const library = path.join(home, 'Rasta.dylib');
    buildGeminiLibrary(library);
    const bundle = { app, executable, native: true, target: 'gemini', version: '1.141.3.1394', build: '1.141.3.1394' };
    const original = fs.readFileSync(executable), fingerprint = appFingerprint(app);
    const options = { allowLocalSigning: true, host: { app, runtime, target: 'gemini', agentVersion: '1.0.5' }, library,
        verifySource: () => run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]) };
    assert.equal(geminiCompatibility(bundle).compatible, true);
    assert.throws(() => stageGemini(bundle), /local signing/);
    assert.throws(() => stageGemini(bundle, { ...options, host: { ...options.host, runtime: path.join(home, 'Library/Application Support/Rasta/ui-runtimes/foreign') } }), /different support directory/);
    stage = stageGemini(bundle, options);
    assert.deepEqual(fs.readFileSync(executable), original);
    assert.equal(appFingerprint(app), fingerprint, 'preparation leaves the original installation alone');
    assert.equal(stage.report.originalDataHash, stage.report.preservedDataHash);
    assert.throws(() => commitGemini(stage, { verifyInstalled: () => { throw Error('Fixture verification failed'); } }), /Fixture verification failed/);
    assert.deepEqual(fs.readFileSync(executable), original, 'failed commit restores the original bundle');
    discardNativeStage(stage); stage = stageGemini(bundle, options);
    commitGemini(stage); discardNativeStage(stage); stage = null;
    assert.equal(verifyInstalledGemini(bundle).signatureVerified, true);
    assert.equal(inspectGemini(bundle).state, 'patched-in-app');
    assert.equal(hostReceipt(bundle).target, 'gemini');
    const env = { ...process.env, RASTA_FIXTURE_RUNTIME: runtime };
    const result = JSON.parse(run(executable, [], { timeout: 35000, env }));
    assert.deepEqual(result.placement, { initial: true, larger: true, smaller: true, flipped: false });
    assert.equal(result.button, 'rasta-reading-controls'); assert.equal(result.panel, true); assert.equal(result.switches, 3);
    assert.equal(result.inWindow, true);
    assert.equal(result.hostHit, true);
    assert.equal(result.launcherOnTop, true);
    assert.equal(result.hiddenOutsideChat, true);
    assert.equal(result.restoredInChat, true);
    assert.deepEqual(result.appearance, { noBorder: true, glyph: true, hoverAndExpanded: true });
    assert.equal(result.dismissed, true);
    assert.equal(result.focusRestored, true);
    assert.equal(result.reopened, true);
    assert.equal(result.closedByLauncher, true);
    assert.equal(result.extraWindows, 0);
    assert.equal(result.titlebarButtons, 0);
    assert.deepEqual(result.sections, ['Reading', 'Typography']);
    assert.equal(result.saved.reading.forceRTL, true, JSON.stringify(result.saved)); assert.equal(result.saved.typography.fs, '16'); assert.match(result.reading.font, /Vazir/); assert.equal(result.reading.size, 18); assert.equal(result.reading.rtl, true);
    assert.equal(result.updatedReading.size, 16);
    assert.equal(result.updatedReading.rtl, true);
    assert.equal(result.shortcut, true); assert.equal(result.fieldEditorPreserved, true);
    const checkMessage = (observed, textKit2) => {
        console.log(JSON.stringify({ textKit2, transcript: observed.transcriptPrompt, paragraph: observed.transcriptGeometry,
            draft: observed.draft, draftParagraph: observed.draftGeometry }));
        assert.equal(observed.transcriptPrompt.font, 'Vazir-Regular');
        assert.deepEqual(observed.transcriptGeometry, [2, 12, -40, 14.4]);
        assert.deepEqual(observed.transcriptEndGeometry, [2, 12, -40, 0]);
        assert.equal(observed.draft.font, 'Vazir-Regular');
        assert.equal(observed.draftGeometry[0], 2, 'the last draft line is explicitly right-aligned');
        assert.ok(observed.rightEdgeDifference.every(delta => delta < 2), `RTL line edges should match: ${observed.rightEdgeDifference}`);
        assert.equal(observed.draftTextAndCaret, true);
        assert.equal(observed.managerDraft.font, 'Vazir-Bold');
        assert.equal(observed.managerTranscript.gap, 5.6);
        console.log(JSON.stringify({ textKit2, prompt: observed.initialPrompt, firstFrame: observed.firstFrame, streamFrame: observed.streamFrame,
            streamAfterSave: observed.streamAfterSave, spaciousAdvance: observed.spaciousAdvance, compactAdvance: observed.compactAdvance }));
        assert.deepEqual(observed.initialPrompt, { font: 'Vazir-Regular', size: 18, gap: 14.4, rtl: false },
            'the sent message uses the selected typography and keeps its natural direction');
        assert.deepEqual(observed.firstFrame, { ...observed.initialPrompt, rtl: true }, 'the first response layout starts with the selected typography');
        assert.deepEqual(observed.streamFrame, observed.firstFrame, 'a vendor update preserves the selected font before layout');
        assert.deepEqual(observed.streamNewRun, observed.firstFrame, 'newly streamed text uses the selected styling');
        assert.equal(observed.vendorNotified, true, 'the vendor delegate still receives edit notifications');
        assert.deepEqual(observed.reboundResponse, observed.firstFrame, 'a replaced response delegate preserves the current font');
        assert.deepEqual(observed.reboundDraft, observed.draft, 'a replaced composer delegate preserves the current font');
        assert.equal(observed.streamAfterSave.size, 16, 'streamed content uses the latest saved size synchronously');
        assert.equal(observed.managerPrompt.font, 'Vazir-Bold', 'the sent message updates when a different font is selected');
        assert.ok(observed.spaciousAdvance.every((advance, index) => observed.compactAdvance[index] > 0 && advance > observed.compactAdvance[index] + 2),
            JSON.stringify({ compact: observed.compactAdvance, spacious: observed.spaciousAdvance }));
        assert.notEqual(observed.saved.selectShadow, 'none');
        assert.equal(observed.saved.reopenNote, false);
        assert.equal(observed.textKit2, textKit2);
        assert.equal(observed.ordinaryUnchanged, true);
        assert.deepEqual(observed.initialMessage, { font: 'Vazir-Regular', size: 18, gap: 14.4, rtl: true });
        assert.deepEqual(observed.englishBeforeForce, { ...observed.initialMessage, rtl: false });
        assert.deepEqual(observed.updatedMessage, { ...observed.initialMessage, size: 16, gap: 12.8 });
        assert.equal(observed.forcedEnglish.rtl, true);
        assert.equal(observed.masterDisabled, true, 'disabling RTL restores native text and passes Shift+2 to Gemini');
        assert.equal(observed.masterRestored, true, 'reenabling RTL restores the saved Force RTL and Shift+2 settings');
        assert.equal(observed.forcedResponseAlignment, true, 'Force RTL takes precedence over the saved left alignment');
        assert.equal(observed.restoredResponseAlignment, true, 'Turning Force RTL off restores the saved left alignment');
        assert.equal(observed.code.size, 11);
        assert.equal(observed.linkAndSelection, true);
        assert.deepEqual(observed.managerMessage, { font: 'Vazir-Bold', size: 14, gap: 5.6, rtl: true });
        assert.equal(observed.englishAfterForce.size, 14);
        assert.equal(observed.englishAfterForce.rtl, false);
        assert.equal(observed.restoredMessage, true);
        assert.equal(observed.streamedContent, true);
    };
    checkMessage(result, false);
    fs.writeFileSync(path.join(support, 'reading-preferences.json'), JSON.stringify({ fs: '18', lh: '1.8', isRTL: true, forceRTL: false, fixAtSign: true }));
    fs.rmSync(path.join(support, 'font-preferences.json'), { force: true });
    const flippedResult = JSON.parse(run(executable, [], { timeout: 35000, env: { ...env, RASTA_FIXTURE_FLIPPED: '1' } }));
    checkMessage(flippedResult, true);
    assert.deepEqual(flippedResult.placement, { initial: true, larger: true, smaller: true, flipped: true });
    assert.equal(flippedResult.inWindow, true);
    assert.equal(flippedResult.hostHit, true);
    assert.equal(flippedResult.launcherOnTop, true);
    assert.equal(flippedResult.hiddenOutsideChat, true);
    assert.equal(flippedResult.restoredInChat, true);
    assert.deepEqual(flippedResult.appearance, result.appearance);
    assert.equal(flippedResult.reopened, true);
    assert.equal(flippedResult.closedByLauncher, true);
    assert.equal(flippedResult.extraWindows, 0);
    const ready = JSON.parse(fs.readFileSync(path.join(support, 'renderer-ready.json')));
    assert.equal(ready.app, app);
    const preferenceFiles = ['reading-preferences.json', 'font-preferences.json'].map(file => path.join(support, file));
    const preferences = preferenceFiles.map(file => fs.readFileSync(file));
    stage = stageGemini(bundle, options); assert.equal(stage.report.refreshing, true);
    commitGemini(stage); discardNativeStage(stage); stage = null;
    assert.deepEqual(preferenceFiles.map(file => fs.readFileSync(file)), preferences, 'Gemini refresh preserves existing reading and font preferences');
    restoreGemini(bundle); assert.deepEqual(fs.readFileSync(executable), original);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    assert.equal(inspectGemini(bundle).state, 'not-patched');
    assert.equal(fs.existsSync(path.join(home, 'Library/Application Support/Rasta')), false);
    console.log(JSON.stringify({ scope: 'isolated-native-host', ...result, rollbackVerified: true, restoreVerified: true }, null, 2));
} finally {
    if (stage) discardNativeStage(stage);
    if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
    if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
    fs.rmSync(home, { recursive: true, force: true });
}
