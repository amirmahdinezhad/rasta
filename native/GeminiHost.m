#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreText/CoreText.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <CommonCrypto/CommonDigest.h>

extern BOOL RastaConfigureNativeText(const char *, CGFloat, CGFloat, BOOL, BOOL);
extern void RastaRefreshGeminiMessageViews(NSView *);
extern void RastaInstallGeminiMessageViewHook(void);
extern void RastaNotifySwiftUIPromptSettings(void);
extern BOOL RastaGeminiResponseDirection(NSTextView *, NSUInteger, NSRange *, BOOL *, BOOL *);
extern BOOL RastaToggleGeminiResponseDirection(NSTextView *, NSUInteger);
extern BOOL RastaIsGeminiComposer(NSView *);

static BOOL hasVisibleComposer(NSView *view) {
    if (view.isHiddenOrHasHiddenAncestor) return NO;
    if (RastaIsGeminiComposer(view) && !NSIsEmptyRect(view.visibleRect)) return YES;
    for (NSView *child in view.subviews) {
        if (hasVisibleComposer(child)) return YES;
    }
    return NO;
}

static BOOL isHostWindow(NSWindow *window) {
    return window.isVisible && !window.attachedSheet && (window.styleMask & NSWindowStyleMaskTitled)
        && ![window isKindOfClass:NSPanel.class] && window.level == NSNormalWindowLevel
        && window.contentView.superview;
}

static BOOL isChatWindow(NSWindow *window) {
    Class settings = NSClassFromString(@"googlemac_Janus_MacApplication_Components_Windows_Windows.SettingsWindow");
    return isHostWindow(window) && !(settings && [window isKindOfClass:settings])
        && hasVisibleComposer(window.contentView);
}

static NSDictionary *readObject(NSString *file) {
    NSData *data = [NSData dataWithContentsOfFile:file];
    if (!data || data.length > 65536) return nil;
    id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    return [object isKindOfClass:NSDictionary.class] ? object : nil;
}

@interface RastaReadingButton : NSButton
@property (nonatomic) BOOL readingActive;
@property (nonatomic) BOOL panelOpen;
@property BOOL hovered;
@property NSTrackingArea *hoverArea;
@property BOOL mirrorsMark;
@end

static NSString *verifiedCustomFont(id entry, NSString *directory) {
    if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"id"] isKindOfClass:NSString.class]
        || ![entry[@"file"] isKindOfClass:NSString.class]) return nil;
    NSString *identifier = entry[@"id"], *file = entry[@"file"], *ext = file.pathExtension;
    if (identifier.length != 32 || [identifier rangeOfCharacterFromSet:
        [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location != NSNotFound
        || ![@[@"ttf", @"otf"] containsObject:ext] || ![file isEqual:[identifier stringByAppendingPathExtension:ext]]) return nil;
    NSString *candidate = [directory stringByAppendingPathComponent:file];
    NSNumber *length;
    [[NSURL fileURLWithPath:candidate] getResourceValue:&length forKey:NSURLFileSizeKey error:NULL];
    if (!length || length.unsignedLongLongValue > 2 * 1024 * 1024) return nil;
    NSData *data = [NSData dataWithContentsOfFile:candidate];
    if (!data || data.length > 2 * 1024 * 1024) return nil;
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *prefix = [NSMutableString string];
    for (NSUInteger index = 0; index < 16; index++) [prefix appendFormat:@"%02x", digest[index]];
    return [prefix isEqual:identifier] ? candidate : nil;
}
static NSColor *triggerGray(NSUInteger value) {
    CGFloat gray = value / 255.0;
    return [NSColor colorWithSRGBRed:gray green:gray blue:gray alpha:1.0];
}

@implementation RastaReadingButton
- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (self.hoverArea) [self removeTrackingArea:self.hoverArea];
    self.hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect
        owner:self userInfo:nil];
    [self addTrackingArea:self.hoverArea];
}
- (void)mouseEntered:(NSEvent *)event { self.hovered = YES; self.needsDisplay = YES; }
- (void)mouseExited:(NSEvent *)event { self.hovered = NO; self.needsDisplay = YES; }
- (void)resetCursorRects {
    [super resetCursorRects];
    [self addCursorRect:self.bounds cursor:NSCursor.pointingHandCursor];
}
- (void)viewDidChangeEffectiveAppearance {
    [super viewDidChangeEffectiveAppearance];
    self.needsDisplay = YES;
}
- (void)setReadingActive:(BOOL)value { _readingActive = value; self.needsDisplay = YES; }
- (void)setPanelOpen:(BOOL)value { _panelOpen = value; [self setAccessibilityExpanded:value]; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirtyRect {
    // Match the desktop panel trigger colors and state fills in desktop-payload.js.
    BOOL dark = [[self.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqual:NSAppearanceNameDarkAqua];
    NSUInteger fill = dark ? 0x24 : 0xde;
    if (self.panelOpen) fill = dark ? 0x34 : 0xf0;
    else if (self.hovered) fill = dark ? 0x2c : 0xe7;
    BOOL focused = self.window.firstResponder == self;
    CGFloat opacity = self.panelOpen || focused ? 1.0 : self.hovered ? 0.94 : 0.84;
    CGContextRef context = NSGraphicsContext.currentContext.CGContext;
    CGContextSaveGState(context);
    CGContextSetAlpha(context, opacity);
    CGContextBeginTransparencyLayer(context, NULL);
    [triggerGray(fill) setFill];
    [[NSBezierPath bezierPathWithRoundedRect:self.bounds xRadius:9 yRadius:9] fill];
    NSUInteger ink = self.readingActive ? (dark ? 0xf0 : 0x24) : (dark ? 0xb8 : 0x60);
    [triggerGray(ink) setFill];
    NSRect tile = NSInsetRect(self.bounds, 5, 5);

    // Draw the shared glyph with rounded leading caps and square trailing edges.
    CGFloat scale = NSWidth(tile) / 32.0;
    for (NSUInteger row = 0; row < 3; row++) {
        CGFloat left = (4.5 + row * 6) * scale + NSMinX(tile);
        CGFloat top = (6 + row * 8) * scale + NSMinY(tile);
        CGFloat y = self.isFlipped ? top : NSHeight(self.bounds) - top - 5 * scale;
        CGFloat right = 26 * scale + NSMinX(tile);
        NSRect bar = NSMakeRect(self.mirrorsMark ? NSWidth(self.bounds) - right : left, y, right - left, 5 * scale);
        [[NSBezierPath bezierPathWithRoundedRect:bar xRadius:2.5 * scale yRadius:2.5 * scale] fill];
        NSRectFill(NSMakeRect(self.mirrorsMark ? NSMinX(bar) : NSMidX(bar), bar.origin.y, bar.size.width / 2, bar.size.height));
    }
    CGContextEndTransparencyLayer(context);
    CGContextRestoreGState(context);
}
@end

static NSRect responseLineBounds(NSTextView *text, NSRect band) {
    // Include every rendered line under the button, including adjacent turns.
    NSPoint origin = text.textContainerOrigin;
    NSRect containerBand = NSOffsetRect(band, -origin.x, -origin.y);
    __block NSRect occupied = NSZeroRect;
    void (^includeLine)(NSRect) = ^(NSRect line) {
        line = NSInsetRect(line, -3, -2);
        if (NSIntersectsRect(line, containerBand)) occupied = NSUnionRect(occupied, line);
    };
    NSTextLayoutManager *modern = text.textLayoutManager;
    if (modern) {
        NSUInteger start = [text characterIndexForInsertionAtPoint:NSMakePoint(NSMidX(band), NSMinY(band))];
        id<NSTextLocation> location = [modern.textContentManager locationFromLocation:modern.documentRange.location
            withOffset:start > 0 ? start - 1 : 0];
        [modern enumerateTextLayoutFragmentsFromLocation:location options:0 usingBlock:^BOOL(NSTextLayoutFragment *fragment) {
            NSRect frame = fragment.layoutFragmentFrame;
            if (NSMinY(frame) > NSMaxY(containerBand) + 2) return NO;
            for (NSTextLineFragment *line in fragment.textLineFragments) {
                includeLine(NSOffsetRect(line.typographicBounds, NSMinX(frame), NSMinY(frame)));
            }
            return YES;
        }];
    } else {
        NSLayoutManager *layout = text.layoutManager;
        NSRange glyphs = [layout glyphRangeForBoundingRect:NSInsetRect(containerBand, 0, -2) inTextContainer:text.textContainer];
        [layout enumerateLineFragmentsForGlyphRange:glyphs
            usingBlock:^(NSRect line, NSRect used, NSTextContainer *container, NSRange range, BOOL *stop) {
                includeLine(used);
            }];
    }
    return NSOffsetRect(occupied, origin.x, origin.y);
}

@interface RastaReadingOverlay : NSView
@property (weak) NSView *hostContent;
@property RastaReadingButton *button;
@property RastaReadingButton *directionButton;
@property (weak) NSTextView *responseView;
@property NSUInteger responseIndex;
@property NSTrackingArea *responseTracking;
@property (weak) WKWebView *panelWebView;
@end

@implementation RastaReadingOverlay
- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (self.responseTracking) [self removeTrackingArea:self.responseTracking];
    self.responseTracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveInKeyWindow | NSTrackingInVisibleRect
        owner:self userInfo:nil];
    [self addTrackingArea:self.responseTracking];
}
- (void)mouseExited:(NSEvent *)event {
    self.directionButton.hidden = YES;
    [self.panelWebView evaluateJavaScript:@"window.rastaNativePanel.movePointer(-1, -1)" completionHandler:nil];
}
- (NSView *)hitTest:(NSPoint)point {
    NSView *hit = [super hitTest:point];
    return hit == self ? nil : hit;
}
@end

@interface RastaGeminiHost : NSObject <WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate>
@property NSDictionary *receipt;
@property NSString *resources;
@property NSString *support;
@property NSMapTable<NSWindow *, RastaReadingOverlay *> *overlays;
@property (weak) NSWindow *panelWindow;
@property BOOL panelWindowAcceptedMouseMoves;
@property WKWebView *web;
@property NSTimer *timer;
@property id keyMonitor;
@property id responseMonitor;
@property NSArray *preferenceSignature;
@property NSDictionary *reading;
@property BOOL textReady;
@property BOOL pageReady;
@property BOOL sentReady;
@property BOOL reportingReady;
@property BOOL hostWindowReady;
@property NSString *pageError;
@end

@implementation RastaGeminiHost
- (void)rpc:(NSString *)action extra:(NSArray<NSString *> *)extra input:(NSData *)input completion:(void (^)(id, NSString *))completion {
    NSString *runtime = self.receipt[@"runtime"];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            NSTask *task = [NSTask new];
            task.executableURL = [NSURL fileURLWithPath:[runtime stringByAppendingPathComponent:@"node"]];
            NSMutableArray *args = [NSMutableArray arrayWithArray:@[[runtime stringByAppendingPathComponent:@"bin/gui-service.js"], @"--rpc", action, @"--app", self.receipt[@"app"]]];
            [args addObjectsFromArray:extra]; task.arguments = args;
            NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
            environment[@"ARTL_TARGET"] = @"gemini"; task.environment = environment;
            NSPipe *output = NSPipe.pipe; task.standardOutput = output;
            NSPipe *stdinPipe = input ? NSPipe.pipe : nil;
            if (stdinPipe) task.standardInput = stdinPipe;
            task.standardError = NSFileHandle.fileHandleWithNullDevice;
            NSError *error;
            if (![task launchAndReturnError:&error]) {
                dispatch_async(dispatch_get_main_queue(), ^{ completion(nil, @"The Rasta service could not start."); }); return;
            }
            if (stdinPipe) {
                [stdinPipe.fileHandleForWriting writeData:input error:NULL];
                [stdinPipe.fileHandleForWriting closeFile];
            }
            NSData *data = [output.fileHandleForReading readDataToEndOfFile];
            [task waitUntilExit];
            NSDictionary *result = data.length <= 4 * 1024 * 1024 ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
            BOOL success = task.terminationStatus == 0 && [result isKindOfClass:NSDictionary.class] && [result[@"ok"] boolValue];
            dispatch_async(dispatch_get_main_queue(), ^{ completion(success ? result[@"value"] : nil,
                success ? nil : ([result[@"error"] isKindOfClass:NSString.class] ? result[@"error"] : @"The Rasta service did not finish.") ); });
        }
    });
}
- (BOOL)loadPreferences {
    NSDictionary *saved = readObject([self.support stringByAppendingPathComponent:@"reading-preferences.json"]) ?: @{};
    self.reading = @{@"isRTL": [saved[@"isRTL"] isKindOfClass:NSNumber.class] ? saved[@"isRTL"] : @YES,
        @"forceRTL": [saved[@"forceRTL"] isKindOfClass:NSNumber.class] ? saved[@"forceRTL"] : @NO,
        @"fixAtSign": [saved[@"fixAtSign"] isKindOfClass:NSNumber.class] ? saved[@"fixAtSign"] : @YES};
    NSString *size = [@[@"14", @"16", @"18"] containsObject:saved[@"fs"]] ? saved[@"fs"] : @"16";
    NSString *spacing = [@[@"1.4", @"1.6", @"1.8"] containsObject:saved[@"lh"]] ? saved[@"lh"] : @"1.6";
    NSString *assets = [self.receipt[@"runtime"] stringByAppendingPathComponent:@"bin/assets"];
    NSString *font = [assets stringByAppendingPathComponent:@"Vazir-Regular.ttf"];
    NSDictionary *fonts = readObject([self.support stringByAppendingPathComponent:@"font-preferences.json"]);
    NSString *selected = [fonts[@"selected"] isKindOfClass:NSString.class] ? fonts[@"selected"] : @"vazir";
    NSArray *entries = [fonts[@"fonts"] isKindOfClass:NSArray.class] ? fonts[@"fonts"] : @[];
    NSString *customDirectory = [self.support stringByAppendingPathComponent:@"custom-fonts"];
    NSString *customFont = nil;
    for (id entry in entries) {
        if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"id"] isEqual:selected]) continue;
        customFont = verifiedCustomFont(entry, customDirectory);
        if (customFont) break;
    }
    if (!customFont && [fonts[@"vazirRemoved"] isEqual:@YES]) {
        for (id entry in entries) {
            customFont = verifiedCustomFont(entry, customDirectory);
            if (customFont) break;
        }
    }
    if (customFont) font = customFont;
    BOOL active = [self.reading[@"isRTL"] boolValue];
    BOOL force = active && [self.reading[@"forceRTL"] boolValue];
    self.textReady = RastaConfigureNativeText(font.fileSystemRepresentation, size.doubleValue, spacing.doubleValue, active, force);
    if (self.textReady) RastaNotifySwiftUIPromptSettings();
    for (RastaReadingOverlay *overlay in self.overlays.objectEnumerator) overlay.button.readingActive = [self.reading[@"isRTL"] boolValue];
    return self.textReady;
}
- (void)attachOverlay:(RastaReadingOverlay *)overlay toContent:(NSView *)content {
    // A sibling receives hits before the SwiftUI content view can route them.
    // The transparent overlay lets Gemini receive input wherever Rasta has no control.
    [overlay removeFromSuperview];
    overlay.hostContent = content;
    NSView *container = content.superview;
    [container addSubview:overlay positioned:NSWindowAbove relativeTo:content];
    [NSLayoutConstraint activateConstraints:@[
        [overlay.leftAnchor constraintEqualToAnchor:content.leftAnchor],
        [overlay.rightAnchor constraintEqualToAnchor:content.rightAnchor],
        [overlay.topAnchor constraintEqualToAnchor:content.topAnchor],
        [overlay.bottomAnchor constraintEqualToAnchor:content.bottomAnchor]]];
}
- (void)updateResponseControl:(RastaReadingOverlay *)overlay atPoint:(NSPoint)point {
    RastaReadingButton *button = overlay.directionButton;
    NSView *content = overlay.hostContent;
    NSPoint local = [overlay convertPoint:point fromView:nil];
    if (!NSPointInRect(local, overlay.bounds) || self.panelWindow == overlay.window) {
        button.hidden = YES;
        return;
    }
    BOOL overButton = !button.hidden && NSPointInRect(local, button.frame);
    NSTextView *text = overlay.responseView;
    NSUInteger index = overlay.responseIndex;
    if (!overButton) {
        NSView *hit = [content hitTest:[content.superview convertPoint:point fromView:nil]];
        while (hit && ![hit isKindOfClass:NSTextView.class]) hit = hit.superview;
        text = (NSTextView *)hit;
        if (text && !text.isEditable) index = [text characterIndexForInsertionAtPoint:[text convertPoint:point fromView:nil]];
    }
    NSRange range;
    BOOL rtl, overridden;
    if (!text || text.window != overlay.window || !RastaGeminiResponseDirection(text, index, &range, &rtl, &overridden)) {
        button.hidden = YES;
        overlay.responseView = nil;
        return;
    }
    NSRect textVisible = NSIntersectionRect(text.bounds, text.visibleRect);
    NSRect visible = NSIntersectionRect(overlay.bounds, [overlay convertRect:textVisible fromView:text]);
    if (NSHeight(visible) < 28 || NSWidth(visible) < 40) { button.hidden = YES; return; }
    // Use the first line of the response for placement. The pointer only selects the response.
    NSRect screen = [text firstRectForCharacterRange:NSMakeRange(range.location, 1) actualRange:NULL];
    if (NSHeight(screen) <= 0) { button.hidden = YES; return; }
    NSRect line = [overlay convertRect:[overlay.window convertRectFromScreen:screen] fromView:nil];
    CGFloat y = MAX(NSMinY(visible), MIN(NSMidY(line) - 14, NSMaxY(visible) - 28));
    NSRect band = [text convertRect:NSMakeRect(NSMinX(visible), y, NSWidth(visible), 28) fromView:overlay];
    NSRect occupied = [overlay convertRect:responseLineBounds(text, band) fromView:text];
    NSRect frame = NSMakeRect(NSMaxX(visible) - 34, y, 28, 28);
    if (NSIntersectsRect(frame, occupied) || NSIntersectsRect(frame, overlay.button.frame)) frame.origin.x = NSMinX(visible) + 6;
    if (NSIsEmptyRect(occupied) || NSIntersectsRect(frame, occupied) || NSIntersectsRect(frame, overlay.button.frame)) {
        button.hidden = YES;
        return;
    }
    button.frame = frame;
    overlay.responseView = text;
    overlay.responseIndex = index;
    button.mirrorsMark = !rtl;
    button.readingActive = overridden;
    button.toolTip = rtl ? @"Switch to left-to-right text" : @"Switch to right-to-left text";
    [button setAccessibilityLabel:button.toolTip];
    button.hidden = NO;
}
- (void)toggleResponseDirection:(RastaReadingButton *)button {
    RastaReadingOverlay *overlay = (RastaReadingOverlay *)button.superview;
    if (!overlay.responseView || overlay.responseView.window != overlay.window) return;
    if (RastaToggleGeminiResponseDirection(overlay.responseView, overlay.responseIndex))
        [self updateResponseControl:overlay atPoint:overlay.window.mouseLocationOutsideOfEventStream];
}
- (void)refresh {
    NSMutableArray *signature = [NSMutableArray array];
    for (NSString *name in @[@"font-preferences.json", @"reading-preferences.json"]) {
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:[self.support stringByAppendingPathComponent:name] error:NULL];
        [signature addObject:@[attributes[NSFileModificationDate] ?: NSNull.null,
            attributes[NSFileSize] ?: NSNull.null, attributes[NSFileSystemFileNumber] ?: NSNull.null]];
    }
    if (![signature isEqual:self.preferenceSignature]) {
        NSDictionary *previousReading = self.reading;
        self.preferenceSignature = signature;
        [self loadPreferences];
        if (self.panelWindow && ![self.reading isEqualToDictionary:previousReading]) {
            [self.web callAsyncJavaScript:@"window.rastaNativePanel.updateReading(reading)"
                arguments:@{@"reading": self.reading} inFrame:nil
                inContentWorld:WKContentWorld.pageWorld completionHandler:nil];
        }
    }
    for (NSWindow *window in NSApp.windows) {
        NSView *content = window.contentView;
        if (isHostWindow(window)) {
            self.hostWindowReady = YES;
            RastaRefreshGeminiMessageViews(content);
        }
        RastaReadingOverlay *overlay = [self.overlays objectForKey:window];
        if (!isChatWindow(window)) {
            [overlay removeFromSuperview];
            if (self.panelWindow == window) [self closePanel];
            [self.overlays removeObjectForKey:window];
            continue;
        }
        if (overlay) {
            if (overlay.hostContent != content || overlay.superview != content.superview) [self attachOverlay:overlay toContent:content];
            if (window.isKeyWindow) [self updateResponseControl:overlay atPoint:window.mouseLocationOutsideOfEventStream];
            else overlay.directionButton.hidden = YES;
            continue;
        }
        RastaReadingButton *button = [RastaReadingButton buttonWithTitle:@"" target:self action:@selector(togglePanel:)];
        button.bordered = NO; button.toolTip = @"Rasta reading controls";
        [button setAccessibilityLabel:@"Rasta reading controls"]; button.identifier = @"rasta-reading-controls";
        button.readingActive = [self.reading[@"isRTL"] boolValue];
        button.translatesAutoresizingMaskIntoConstraints = NO;
        overlay = [RastaReadingOverlay new];
        overlay.translatesAutoresizingMaskIntoConstraints = NO;
        overlay.button = button;
        [overlay addSubview:button];
        RastaReadingButton *direction = [RastaReadingButton buttonWithTitle:@"" target:self action:@selector(toggleResponseDirection:)];
        direction.bordered = NO;
        direction.identifier = @"rasta-message-direction";
        direction.hidden = YES;
        overlay.directionButton = direction;
        [overlay addSubview:direction];
        [NSLayoutConstraint activateConstraints:@[
            [button.rightAnchor constraintEqualToAnchor:overlay.rightAnchor constant:-16],
            [button.bottomAnchor constraintEqualToAnchor:overlay.bottomAnchor constant:-16],
            [button.widthAnchor constraintEqualToConstant:28],
            [button.heightAnchor constraintEqualToConstant:28]]];
        [self attachOverlay:overlay toContent:content];
        [self.overlays setObject:overlay forKey:window];
    }
    [self confirmReady];
}
- (void)confirmReady {
    if (!self.textReady || !self.pageReady || self.sentReady || self.reportingReady || !self.hostWindowReady) return;
    self.reportingReady = YES;
    [self rpc:@"ready" extra:@[] input:nil completion:^(id value, NSString *error) { self.reportingReady = NO; self.sentReady = error == nil; }];
}
- (void)closePanel {
    NSWindow *window = self.panelWindow;
    if (!window) return;
    [self.web evaluateJavaScript:@"window.rastaNativePanel.close()" completionHandler:nil];
    [self.web removeFromSuperview]; self.panelWindow = nil;
    window.acceptsMouseMovedEvents = self.panelWindowAcceptedMouseMoves;
    RastaReadingOverlay *overlay = [self.overlays objectForKey:window];
    overlay.panelWebView = nil;
    RastaReadingButton *button = overlay.button;
    button.panelOpen = NO;
    if (button.window == window) [window makeFirstResponder:button];
}
- (void)togglePanel:(RastaReadingButton *)button {
    NSWindow *window = button.window;
    if (!isChatWindow(window) || !self.pageReady) return;
    if (self.panelWindow == window) { [self closePanel]; return; }
    [self closePanel];
    self.panelWindow = window;
    self.panelWindowAcceptedMouseMoves = window.acceptsMouseMovedEvents;
    [self.overlays objectForKey:window].directionButton.hidden = YES;
    button.panelOpen = YES;
    RastaReadingOverlay *overlay = (RastaReadingOverlay *)button.superview;
    overlay.panelWebView = self.web;
    self.web.translatesAutoresizingMaskIntoConstraints = NO;
    [overlay addSubview:self.web positioned:NSWindowBelow relativeTo:button];
    [NSLayoutConstraint activateConstraints:@[
        [self.web.leftAnchor constraintEqualToAnchor:overlay.leftAnchor],
        [self.web.rightAnchor constraintEqualToAnchor:overlay.rightAnchor],
        [self.web.topAnchor constraintEqualToAnchor:overlay.topAnchor],
        [self.web.bottomAnchor constraintEqualToAnchor:overlay.bottomAnchor]]];
    [window makeFirstResponder:self.web];
    // Gemini's window can have mouse-moved delivery disabled even with WebKit attached.
    window.acceptsMouseMovedEvents = YES;
    [self.web evaluateJavaScript:@"window.rastaNativePanel.show()" completionHandler:nil];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message replyHandler:(void (^)(id, NSString *))reply {
    NSString *expected = [self.resources stringByAppendingPathComponent:@"panel.html"];
    if (message.webView != self.web || !message.frameInfo.mainFrame || ![message.frameInfo.request.URL.path isEqual:expected] || ![message.body isKindOfClass:NSDictionary.class]) {
        reply(nil, @"The Rasta panel request was rejected."); return;
    }
    NSDictionary *body = message.body; NSString *action = body[@"action"];
    if ([action isEqual:@"mounted"]) { self.pageReady = YES; [self confirmReady]; reply(@YES, nil); return; }
    if ([action isEqual:@"dismiss"]) { [self closePanel]; reply(@YES, nil); return; }
    NSArray *extra = @[];
    NSData *input = nil;
    BOOL changesPreferences = YES;
    if ([action isEqual:@"reading-save"]) {
        id key = body[@"key"], value = body[@"value"];
        BOOL boolean = [@[@"isRTL", @"forceRTL", @"fixAtSign"] containsObject:key]
            && [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID();
        BOOL typography = ([key isEqual:@"fs"] && [@[@"14", @"16", @"18"] containsObject:value])
            || ([key isEqual:@"lh"] && [@[@"1.4", @"1.6", @"1.8"] containsObject:value]);
        if (!boolean && !typography) { reply(nil, @"Invalid reading setting."); return; }
        extra = @[@"--reading-key", key, @"--reading-value", boolean ? ([value boolValue] ? @"true" : @"false") : value];
    } else if ([action isEqual:@"font-select"] || [action isEqual:@"font-remove"]) {
        if (![body[@"id"] isKindOfClass:NSString.class] || [body[@"id"] length] > 32) { reply(nil, @"Invalid reading font."); return; }
        input = [NSJSONSerialization dataWithJSONObject:@{@"id": body[@"id"]} options:0 error:NULL];
    } else if ([action isEqual:@"font-import"]) {
        NSString *name = body[@"name"], *data = body[@"data"];
        if (![name isKindOfClass:NSString.class] || name.length > 1024 || ![data isKindOfClass:NSString.class]
            || !data.length || data.length > 2796204) { reply(nil, @"Invalid reading font."); return; }
        input = [NSJSONSerialization dataWithJSONObject:@{@"name": name, @"data": data} options:0 error:NULL];
    } else {
        changesPreferences = NO;
        if (![@[@"preferences", @"check", @"manager-open"] containsObject:action]) { reply(nil, @"Unknown Rasta action."); return; }
    }
    [self rpc:action extra:extra input:input completion:^(id value, NSString *error) {
        if (!error && changesPreferences) [self refresh];
        reply(value ?: @{}, error);
    }];
}
- (void)webView:(WKWebView *)web runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))completion {
    NSString *expected = [self.resources stringByAppendingPathComponent:@"panel.html"];
    if (web != self.web || !frame.mainFrame || !frame.request.URL.isFileURL || ![frame.request.URL.path isEqual:expected]) {
        completion(nil); return;
    }
    NSOpenPanel *picker = NSOpenPanel.openPanel;
    picker.allowsMultipleSelection = parameters.allowsMultipleSelection;
    picker.canChooseDirectories = NO;
    picker.allowedContentTypes = @[[UTType typeWithFilenameExtension:@"ttf"], [UTType typeWithFilenameExtension:@"otf"]];
    picker.allowsOtherFileTypes = NO;

    [picker beginWithCompletionHandler:^(NSModalResponse response) {
        completion(response == NSModalResponseOK ? picker.URLs : nil);
    }];
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    BOOL allowed = action.targetFrame.mainFrame && [action.request.URL.path isEqual:[self.resources stringByAppendingPathComponent:@"panel.html"]] && action.request.URL.isFileURL;
    handler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.pageError = error.localizedDescription; }
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.pageError = error.localizedDescription; }
- (NSEvent *)handleKeyEvent:(NSEvent *)event {
    NSEventModifierFlags modifiers = event.modifierFlags & (NSEventModifierFlagShift | NSEventModifierFlagControl | NSEventModifierFlagCommand | NSEventModifierFlagOption);
    NSWindow *window = event.window;
    id responder = window.firstResponder;
    if ([self.reading[@"isRTL"] boolValue] && [self.reading[@"fixAtSign"] boolValue]
        && event.keyCode == 19 && modifiers == NSEventModifierFlagShift
        && [responder isKindOfClass:NSTextView.class] && isChatWindow(window)) {
        NSTextView *text = responder;
        if (text.isEditable && !text.isFieldEditor && !text.hasMarkedText) { [text insertText:@"@" replacementRange:text.selectedRange]; return nil; }
    }
    return event;
}
- (void)start {
    self.overlays = [NSMapTable weakToStrongObjectsMapTable];
    NSString *assets = [self.receipt[@"runtime"] stringByAppendingPathComponent:@"bin/assets"];
    for (NSString *name in @[@"Vazir-Regular.ttf", @"Vazir-Bold.ttf"]) CTFontManagerRegisterFontsForURL((__bridge CFURLRef)[NSURL fileURLWithPath:[assets stringByAppendingPathComponent:name]], kCTFontManagerScopeProcess, NULL);
    [self loadPreferences];
    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
    [configuration.userContentController addScriptMessageHandlerWithReply:self contentWorld:WKContentWorld.pageWorld name:@"rasta"];
    self.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 360, 420) configuration:configuration];
    self.web.navigationDelegate = self; self.web.UIDelegate = self; [self.web setValue:@NO forKey:@"drawsBackground"];
    [self.web loadFileURL:[NSURL fileURLWithPath:[self.resources stringByAppendingPathComponent:@"panel.html"]] allowingReadAccessToURL:[NSURL fileURLWithPath:self.resources]];
    __weak RastaGeminiHost *weak = self;
    self.keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
        RastaGeminiHost *host = weak;
        return host ? [host handleKeyEvent:event] : event;
    }];
    self.responseMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved | NSEventMaskScrollWheel
        handler:^NSEvent *(NSEvent *event) {
        RastaGeminiHost *host = weak;
        NSWindow *window = event.window;
        RastaReadingOverlay *overlay = window ? [host.overlays objectForKey:window] : nil;
        if (overlay) {
            if (event.type == NSEventTypeScrollWheel) overlay.directionButton.hidden = YES;
            else if (host.panelWindow == window) {
                WKWebView *web = host.web;
                NSPoint point = [web convertPoint:event.locationInWindow fromView:nil];
                CGFloat y = web.isFlipped ? point.y : NSHeight(web.bounds) - point.y;
                // Report the pointer even when WebKit does not update :hover in the host overlay.
                [web evaluateJavaScript:[NSString stringWithFormat:@"window.rastaNativePanel.movePointer(%f, %f)", point.x, y]
                    completionHandler:nil];
            }
            else [host updateResponseControl:overlay atPoint:event.locationInWindow];
        }
        return event;
    }];
    self.timer = [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) { [weak refresh]; }];
    [self refresh];
}
@end

__attribute__((constructor)) static void startGeminiReading(void) {
    @autoreleasepool {
        NSString *app = NSBundle.mainBundle.bundlePath;
        if (![NSBundle.mainBundle.bundleIdentifier isEqual:@"com.google.GeminiMacOS"]) return;
        NSString *resources = [app stringByAppendingPathComponent:@"Contents/Resources/rasta"];
        NSDictionary *receipt = readObject([resources stringByAppendingPathComponent:@"host.json"]);
        NSString *runtime = [receipt[@"runtime"] isKindOfClass:NSString.class] ? receipt[@"runtime"] : @"";
        if (![receipt[@"target"] isEqual:@"gemini"] || ![receipt[@"app"] isKindOfClass:NSString.class]
            || ![[receipt[@"app"] stringByResolvingSymlinksInPath] isEqual:app.stringByResolvingSymlinksInPath] || !runtime.isAbsolutePath
            || ![runtime.lastPathComponent length] || ![runtime.stringByDeletingLastPathComponent.lastPathComponent isEqual:@"ui-runtimes"] || ![receipt[@"agentVersion"] isKindOfClass:NSString.class]) return;
        static RastaGeminiHost *host;
        host = [RastaGeminiHost new]; host.receipt = receipt; host.resources = resources;
        host.support = runtime.stringByDeletingLastPathComponent.stringByDeletingLastPathComponent;
        // Configure before the vendor builds its first cached text layouts.
        [host loadPreferences];
        RastaInstallGeminiMessageViewHook();
        dispatch_async(dispatch_get_main_queue(), ^{ [host start]; });
    }
}
