#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
#import <dlfcn.h>
#import <mach-o/dyld.h>
#import <objc/runtime.h>
#import <pthread.h>
#import <sys/stat.h>
#import <stdatomic.h>

// Core Text factories retain the vendor's original attributed string and code runs.
static pthread_mutex_t settingsLock = PTHREAD_MUTEX_INITIALIZER;
static CTFontRef selectedFont;
static BOOL enabled;
static BOOL forceDirection;
static CGFloat lineHeightMultiple = 1.6;
static atomic_ulong readingRevision;
static atomic_ulong factoryCalls;
static atomic_ulong hostCalls;
static _Atomic(void *) hostImageBase;
static NSString *const userPromptAttribute = @"JanusUserPromptBubble";

__attribute__((visibility("default")))
NSDictionary *RastaTextProbeStatus(void) {
    return @{@"factoryCalls": @(atomic_load(&factoryCalls)), @"hostCalls": @(atomic_load(&hostCalls))};
}

__attribute__((visibility("default")))
BOOL RastaConfigureNativeText(const char *file, CGFloat size, CGFloat spacing, BOOL active, BOOL force) {
    if (!file || !isfinite(size) || size < 10 || size > 32 || !isfinite(spacing) || spacing < 1 || spacing > 3) return NO;
    NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:file]];
    CFArrayRef descriptors = CTFontManagerCreateFontDescriptorsFromURL((__bridge CFURLRef)url);
    if (!descriptors || CFArrayGetCount(descriptors) == 0) {
        if (descriptors) CFRelease(descriptors);
        return NO;
    }
    CTFontRef font = CTFontCreateWithFontDescriptor(CFArrayGetValueAtIndex(descriptors, 0), size, NULL);
    CFRelease(descriptors);
    pthread_mutex_lock(&settingsLock);
    if (selectedFont) CFRelease(selectedFont);
    selectedFont = font;
    enabled = active;
    forceDirection = force;
    lineHeightMultiple = spacing;
    atomic_fetch_add(&readingRevision, 1);
    pthread_mutex_unlock(&settingsLock);
    return font != NULL;
}

__attribute__((visibility("default")))
BOOL RastaConfigureTextProbe(const char *file, CGFloat size, BOOL active) {
    return RastaConfigureNativeText(file, size, 1.6, active, NO);
}

static BOOL hasRTL(NSString *text) {
    for (NSUInteger index = 0; index < text.length; index++) {
        unichar character = [text characterAtIndex:index];
        if ((character >= 0x0590 && character <= 0x08ff)
            || (character >= 0xfb1d && character <= 0xfdff)
            || (character >= 0xfe70 && character <= 0xfeff)) return YES;
    }
    return NO;
}

static BOOL calledByHost(const void *address) {
    Dl_info image;
    if (!dladdr(address, &image)) return NO;
    void *knownHost = atomic_load(&hostImageBase);
    if (knownHost) return knownHost == image.dli_fbase;
    char executable[PATH_MAX];
    uint32_t length = sizeof(executable);
    if (_NSGetExecutablePath(executable, &length) != 0) return NO;
    struct stat host, caller;
    BOOL matches = stat(executable, &host) == 0 && stat(image.dli_fname, &caller) == 0
        && host.st_dev == caller.st_dev && host.st_ino == caller.st_ino;
    if (matches) atomic_store(&hostImageBase, image.dli_fbase);
    return matches;
}

// The sent bubble uses two SwiftUI Text initializers. Only enable styling
// when the verified build, caller image and adjacent instructions match.
CFDictionaryRef RastaCopySwiftUIPromptSettings(uintptr_t caller, NSUInteger attributed) {
    if (@available(macOS 26.0, *)) {
        NSBundle *bundle = NSBundle.mainBundle;
        if (![bundle.bundleIdentifier isEqual:@"com.google.GeminiMacOS"]) return NULL;
        NSString *version = bundle.infoDictionary[@"CFBundleVersion"];
        uintptr_t returnOffset;
        uint32_t callInstruction;
        if ([version isEqual:@"1.147.6.1557"]) {
            returnOffset = attributed ? 0xa4c370 : 0xa4c320;
            callInstruction = attributed ? 0x95e9e93c : 0x95d7754e;
        } else if ([version isEqual:@"1.147.5.1526"]) {
            returnOffset = attributed ? 0xa4c358 : 0xa4c308;
            callInstruction = attributed ? 0x95e9eb96 : 0x95d77563;
        } else return NULL;
        const struct mach_header *host = _dyld_get_image_header(0);
        if (!host || caller != (uintptr_t)host + returnOffset || !calledByHost((const void *)caller)) return NULL;
        const uint32_t *instruction = (const uint32_t *)caller;
        if (instruction[-1] != callInstruction
            || instruction[0] != (attributed ? 0xaa0003fa : 0xd10143bf)) return NULL;
        pthread_mutex_lock(&settingsLock);
        NSDictionary *settings = enabled && selectedFont ? @{
            @"font": (__bridge id)selectedFont, @"spacing": @(lineHeightMultiple), @"force": @(forceDirection)
        } : @{};
        pthread_mutex_unlock(&settingsLock);
        return (CFDictionaryRef)CFBridgingRetain(settings);
    }
    return NULL;
}

static id readingParagraph(id existing, CGFloat gap, CGFloat fontHeight, NSWritingDirection direction, BOOL prompt, BOOL promptContinues) {
    if (!existing || [existing isKindOfClass:NSParagraphStyle.class]) {
        NSMutableParagraphStyle *paragraph = existing ? [existing mutableCopy] : [NSMutableParagraphStyle new];
        if (direction == NSWritingDirectionRightToLeft) {
            // The unified transcript stores the prompt's column in LTR coordinates.
            // Mirror its insets to keep the same column when TextKit lays it out RTL.
            if (prompt && paragraph.baseWritingDirection != NSWritingDirectionRightToLeft && paragraph.tailIndent <= 0) {
                CGFloat leftInset = paragraph.headIndent;
                paragraph.headIndent = paragraph.firstLineHeadIndent = -paragraph.tailIndent;
                paragraph.tailIndent = -leftInset;
            }
            paragraph.baseWritingDirection = NSWritingDirectionRightToLeft;
            paragraph.alignment = NSTextAlignmentRight;
        } else if (direction == NSWritingDirectionLeftToRight) {
            paragraph.baseWritingDirection = NSWritingDirectionLeftToRight;
            paragraph.alignment = NSTextAlignmentLeft;
        }
        // TextKit clamps the line-height multiplier to the vendor's maximum height.
        // Add the selected gap separately and leave enough room for larger glyphs.
        paragraph.lineHeightMultiple = 1;
        paragraph.lineSpacing = gap;
        // Gemini can put each measured line of a sent prompt in its own paragraph.
        if (promptContinues) paragraph.paragraphSpacing = MAX(paragraph.paragraphSpacing, gap);
        if (paragraph.maximumLineHeight > 0) paragraph.maximumLineHeight = MAX(paragraph.maximumLineHeight, fontHeight);
        return paragraph;
    }
    if (CFGetTypeID((__bridge CFTypeRef)existing) != CTParagraphStyleGetTypeID()) return nil;
    // Preserve every public Core Text paragraph field, including tabs and indents.
    union Value { CGFloat scalar; CTTextAlignment alignment; CFArrayRef tabs; CTLineBreakMode lineBreak;
        CTWritingDirection direction; CTLineBoundsOptions bounds; } values[kCTParagraphStyleSpecifierCount];
    CTParagraphStyleSetting settings[kCTParagraphStyleSpecifierCount]; size_t count = 0;
    for (uint32_t spec = 0; spec < kCTParagraphStyleSpecifierCount; spec++) {
        size_t size = sizeof(CGFloat);
        if (spec == kCTParagraphStyleSpecifierAlignment) size = sizeof(CTTextAlignment);
        else if (spec == kCTParagraphStyleSpecifierTabStops) size = sizeof(CFArrayRef);
        else if (spec == kCTParagraphStyleSpecifierLineBreakMode) size = sizeof(CTLineBreakMode);
        else if (spec == kCTParagraphStyleSpecifierBaseWritingDirection) size = sizeof(CTWritingDirection);
        else if (spec == kCTParagraphStyleSpecifierLineBoundsOptions) size = sizeof(CTLineBoundsOptions);
        if (!CTParagraphStyleGetValueForSpecifier((__bridge CTParagraphStyleRef)existing, spec, size, &values[spec])) continue;
        if (spec == kCTParagraphStyleSpecifierBaseWritingDirection && direction != NSWritingDirectionNatural)
            values[spec].direction = direction == NSWritingDirectionRightToLeft ? kCTWritingDirectionRightToLeft : kCTWritingDirectionLeftToRight;
        if (spec == kCTParagraphStyleSpecifierAlignment && direction != NSWritingDirectionNatural)
            values[spec].alignment = direction == NSWritingDirectionRightToLeft ? kCTTextAlignmentRight : kCTTextAlignmentLeft;
        if (spec == kCTParagraphStyleSpecifierLineHeightMultiple) values[spec].scalar = 1;
        if (spec == kCTParagraphStyleSpecifierLineSpacingAdjustment) values[spec].scalar = gap;
        if (spec == kCTParagraphStyleSpecifierMaximumLineHeight && values[spec].scalar > 0)
            values[spec].scalar = MAX(values[spec].scalar, fontHeight);
        settings[count++] = (CTParagraphStyleSetting){ spec, size, &values[spec] };
    }
    return CFBridgingRelease(CTParagraphStyleCreate(settings, count));
}

typedef NS_ENUM(NSUInteger, RastaTextScope) { RastaCoreText, RastaMessage, RastaPrompt, RastaComposer, RastaTranscript };

static NSAttributedString *readingText(NSAttributedString *original, RastaTextScope scope,
                                      NSDictionary<NSNumber *, NSNumber *> *directions) {
    pthread_mutex_lock(&settingsLock);
    CTFontRef font = enabled && selectedFont ? (CTFontRef)CFRetain(selectedFont) : NULL;
    BOOL force = forceDirection;
    CGFloat spacing = lineHeightMultiple;
    pthread_mutex_unlock(&settingsLock);
    if (!font) return original;
    if (!original.length || (scope == RastaCoreText && !force && !hasRTL(original.string))) { CFRelease(font); return original; }
    NSMutableAttributedString *result = [original mutableCopy];
    const CGFloat gap = CTFontGetSize(font) * (spacing - 1);
    __block NSRange bubbleRange = NSMakeRange(0, 0);
    __block BOOL bubbleRTL = NO;
    __block NSRange responseRange = NSMakeRange(0, 0);
    __block NSNumber *override = directions[@0];
    [original.string enumerateSubstringsInRange:NSMakeRange(0, original.length) options:NSStringEnumerationByParagraphs
        usingBlock:^(NSString *text, NSRange range, NSRange enclosing, BOOL *stop) {
            BOOL prompt = NSLocationInRange(enclosing.location, bubbleRange);
            if (!prompt && (scope == RastaMessage || scope == RastaTranscript) &&
                [original attribute:userPromptAttribute atIndex:enclosing.location effectiveRange:NULL]) {
                [original attribute:userPromptAttribute atIndex:enclosing.location longestEffectiveRange:&bubbleRange
                    inRange:NSMakeRange(0, original.length)];
                bubbleRTL = hasRTL([original.string substringWithRange:bubbleRange]);
                prompt = YES;
            }
            if (scope == RastaTranscript && !prompt && directions.count && !NSLocationInRange(enclosing.location, responseRange)) {
                [original attribute:userPromptAttribute atIndex:enclosing.location longestEffectiveRange:&responseRange
                    inRange:NSMakeRange(0, original.length)];
                override = directions[@(responseRange.location)];
            }
            BOOL rtl = force || (prompt ? bubbleRTL : hasRTL(text));
            NSWritingDirection direction = (!force && !prompt && override) ? override.integerValue
                : rtl ? NSWritingDirectionRightToLeft : NSWritingDirectionNatural;
            if (scope == RastaCoreText && !rtl) return;
            BOOL promptContinues = prompt && NSMaxRange(enclosing) < NSMaxRange(bubbleRange);
            BOOL plain = prompt || scope == RastaPrompt || scope == RastaComposer;
            [original enumerateAttributesInRange:enclosing options:0
                usingBlock:^(NSDictionary<NSAttributedStringKey, id> *attributes, NSRange run, BOOL *stopRun) {
                    CTFontRef current = (__bridge CTFontRef)attributes[NSFontAttributeName];
                    if (attributes[NSAttachmentAttributeName] || (!plain && current && (CTFontGetSymbolicTraits(current) & kCTFontMonoSpaceTrait))) return;
                    CTFontSymbolicTraits traits = current ? CTFontGetSymbolicTraits(current) & (kCTFontBoldTrait | kCTFontItalicTrait) : 0;
                    CTFontRef styled = traits ? CTFontCreateCopyWithSymbolicTraits(font, 0, NULL, traits, traits) : NULL;
                    // Keep vendor emphasis when the selected face has no matching variant.
                    if (traits && !styled && current && !plain)
                        styled = CTFontCreateCopyWithAttributes(current, CTFontGetSize(font), NULL, NULL);
                    CTFontRef runFont = styled ?: font;
                    CGFloat height = ceil(CTFontGetAscent(runFont) + CTFontGetDescent(runFont) + CTFontGetLeading(runFont));
                    id paragraph = readingParagraph(attributes[NSParagraphStyleAttributeName], gap, height, direction, prompt, promptContinues);
                    [result addAttribute:NSFontAttributeName value:(__bridge id)runFont range:run];
                    if (paragraph) [result addAttribute:NSParagraphStyleAttributeName value:paragraph range:run];
                    if (styled) CFRelease(styled);
                }];
        }];
    CFRelease(font);
    return result;
}

static BOOL sameAttribute(id left, id right) { return left == right || [left isEqual:right]; }

@interface RastaMessageStyle : NSObject <NSTextStorageDelegate>
@property (weak) NSTextView *view;
@property (weak) NSTextStorage *storage;
@property NSMutableAttributedString *source;
@property NSAttributedString *displayed;
@property unsigned long revision;
@property BOOL applying;
@property RastaTextScope scope;
@property NSMutableDictionary<NSNumber *, NSNumber *> *directions;
@property (weak) id<NSTextStorageDelegate> vendorDelegate;
- (void)refresh;
- (void)applyStyleDuringEdit:(BOOL)duringEdit;
@end

@implementation RastaMessageStyle
- (void)applyStyleDuringEdit:(BOOL)duringEdit {
    NSTextStorage *storage = self.storage;
    NSTextView *view = self.view;
    BOOL composer = self.scope == RastaComposer;
    if (!storage || view.textStorage != storage || view.isFieldEditor || view.isEditable != composer) return;
    if (composer && view.hasMarkedText) {
        self.revision = 0;
        return;
    }
    self.revision = atomic_load(&readingRevision);
    NSAttributedString *styled = readingText(self.source, self.scope, self.directions);
    if ([styled isEqualToAttributedString:self.displayed]) return;
    // Attribute-only edits preserve the selection, links, attachments and the viewport.
    self.applying = YES;
    void (^edit)(void) = ^{
        for (NSAttributedStringKey key in @[NSFontAttributeName, NSParagraphStyleAttributeName]) {
            [styled enumerateAttribute:key inRange:NSMakeRange(0, styled.length) options:0
                usingBlock:^(id value, NSRange range, BOOL *stop) {
                    [self.displayed enumerateAttribute:key inRange:range options:0
                        usingBlock:^(id prior, NSRange changed, BOOL *stop) {
                            if (sameAttribute(prior, value)) return;
                            if (value) [storage addAttribute:key value:value range:changed];
                            else [storage removeAttribute:key range:changed];
                        }];
                }];
        }
    };
    if (duringEdit) edit();
    else {
        void (^transaction)(void) = ^{
            [storage beginEditing];
            edit();
            [storage endEditing];
        };
        if (view.textContentStorage) [view.textContentStorage performEditingTransactionUsingBlock:transaction];
        else transaction();
    }
    self.displayed = [storage copy];
    self.applying = NO;
    if (!duringEdit) [view invalidateIntrinsicContentSize];
}
- (void)refresh {
    if (self.revision != atomic_load(&readingRevision)) [self applyStyleDuringEdit:NO];
}
- (void)textStorage:(NSTextStorage *)storage willProcessEditing:(NSTextStorageEditActions)mask
    range:(NSRange)range changeInLength:(NSInteger)delta {
    id<NSTextStorageDelegate> vendor = self.vendorDelegate;
    if ([vendor respondsToSelector:_cmd])
        [vendor textStorage:storage willProcessEditing:mask range:range changeInLength:delta];
}
- (void)textStorage:(NSTextStorage *)storage didProcessEditing:(NSTextStorageEditActions)mask
    range:(NSRange)range changeInLength:(NSInteger)delta {
    id<NSTextStorageDelegate> vendor = self.vendorDelegate;
    if ([vendor respondsToSelector:_cmd])
        [vendor textStorage:storage didProcessEditing:mask range:range changeInLength:delta];
    if (self.applying || self.view.textStorage != storage) return;
    NSRange edited = storage.editedRange;
    NSInteger oldLength = (NSInteger)edited.length - storage.changeInLength;
    NSUInteger priorLength = self.source.length;
    if ((mask & NSTextStorageEditedCharacters) && edited.location < priorLength && self.directions.count
        && !(storage.length > priorLength && [storage.string hasPrefix:self.source.string])) {
        // A replaced or recycled transcript has no verified correspondence to
        // the old ranges. Preserve choices only for append-only streaming.
        [self.directions removeAllObjects];
    }
    if (edited.location > storage.length || edited.length > storage.length - edited.location
        || edited.location > priorLength || oldLength < 0 || (NSUInteger)oldLength > priorLength - edited.location
        || priorLength - (NSUInteger)oldLength + edited.length != storage.length) {
        self.source = [storage mutableCopy];
    } else {
        NSRange priorRange = NSMakeRange(edited.location, (NSUInteger)oldLength);
        if (storage.editedMask == NSTextStorageEditedCharacters) {
            // Plain-text streaming edits inherit the vendor's source attributes.
            [self.source replaceCharactersInRange:priorRange withString:[storage.string substringWithRange:edited]];
        } else {
            NSMutableAttributedString *incoming = [[storage attributedSubstringFromRange:edited] mutableCopy];
            if (!(storage.editedMask & NSTextStorageEditedCharacters)) {
                // An unrelated attribute edit can report a run that still contains our
                // font or paragraph style. Keep the vendor value for each unchanged key.
                NSAttributedString *reported = [incoming copy];
                for (NSAttributedStringKey key in @[NSFontAttributeName, NSParagraphStyleAttributeName]) {
                    [self.displayed enumerateAttribute:key inRange:edited options:0
                        usingBlock:^(id shown, NSRange absolute, BOOL *stop) {
                            NSRange local = NSMakeRange(absolute.location - edited.location, absolute.length);
                            [reported enumerateAttribute:key inRange:local options:0
                                usingBlock:^(id value, NSRange span, BOOL *stop) {
                                    if (!sameAttribute(shown, value)) return;
                                    NSRange original = NSMakeRange(edited.location + span.location, span.length);
                                    [self.source enumerateAttribute:key inRange:original options:0
                                        usingBlock:^(id sourceValue, NSRange sourceRange, BOOL *stop) {
                                            sourceRange.location -= edited.location;
                                            if (sourceValue) [incoming addAttribute:key value:sourceValue range:sourceRange];
                                            else [incoming removeAttribute:key range:sourceRange];
                                        }];
                                }];
                        }];
                }
            }
            [self.source replaceCharactersInRange:priorRange withAttributedString:incoming];
        }
    }
    self.displayed = [storage copy];
    // TextKit calls the delegate before sending the edit to its layout managers.
    // Restrict the in-flight update to attributes to preserve the original edit range.
    [self applyStyleDuringEdit:YES];
}
@end

static BOOL isMessageView(NSTextView *view) {
    // The Objective-C runtime can report a demangled name for a Swift class.
    // Resolve the bundle's class identifiers and match subclasses by identity.
    static const char *names[] = {
        "_TtC82googlemac_Janus_MacApplication_Components_Chat_Canvas_SelectableMessageContentView25SelectableMessageTextView",
        "_TtC105googlemac_Janus_MacApplication_Components_Chat_ChatMessageTree_MessageContainer_Platform_PlatformTextView16PlatformTextView",
        "_TtC102googlemac_Janus_MacApplication_Components_Chat_ChatMessageTree_MessageContainer_UnifiedMessageTextView18AttachmentTextView",
        "_TtC88googlemac_Janus_MacApplication_Components_Chat_SingleChatTranscript_SingleChatTranscript28SingleChatTranscriptTextView",
        "_TtC99googlemac_Janus_MacApplication_Components_Chat_ChatMessageTree_NodeViews_Table_MessageTreeTableView23IntrinsicSizingTextView",
    };
    for (NSUInteger index = 0; index < sizeof(names) / sizeof(names[0]); index++) {
        Class messageClass = objc_lookUpClass(names[index]);
        if (messageClass && [view isKindOfClass:messageClass]) return YES;
    }
    return NO;
}

static BOOL isSwiftUIPrompt(NSTextView *view) {
    // The sent bubble wraps a plain NSTextView in a SwiftUI representable.
    // Its generic host identifies it without treating other read-only views as messages.
    NSScrollView *scroll = view.enclosingScrollView;
    if (scroll.documentView != view) return NO;
    for (NSView *ancestor = scroll.superview; ancestor; ancestor = ancestor.superview) {
        for (Class host = object_getClass(ancestor); host; host = class_getSuperclass(host)) {
            const char *name = class_getName(host);
            if (strstr(name, "AppKitPlatformViewHost") || strstr(name, "NSHostingView")) {
                if (strstr(name, "V62googlemac_Janus_MacApplication_Components_Chat_UserMessageView23FastUserMessageTextView")
                    || strstr(name, "googlemac_Janus_MacApplication_Components_Chat_UserMessageView.FastUserMessageTextView")) return YES;
            }
        }
    }
    return NO;
}

BOOL RastaIsGeminiComposer(NSView *view) {
    Class composer = objc_lookUpClass("_TtC61googlemac_Janus_MacApplication_Components_RichInput_RichInput14RichNSTextView");
    if (!composer || ![view isKindOfClass:composer]) return NO;
    NSTextView *text = (NSTextView *)view;
    return text.isEditable && !text.isFieldEditor;
}

static char styleKey;
static BOOL isTranscriptView(NSTextView *view) {
    Class type = objc_lookUpClass("_TtC88googlemac_Janus_MacApplication_Components_Chat_SingleChatTranscript_SingleChatTranscript28SingleChatTranscriptTextView");
    return type && [view isKindOfClass:type];
}

static void prepareMessageView(NSTextView *view) {
    if (view.isFieldEditor) return;
    RastaTextScope scope = RastaMessage;
    if (view.isEditable) {
        if (!RastaIsGeminiComposer(view)) return;
        scope = RastaComposer;
    } else if (!isMessageView(view)) {
        if (!isSwiftUIPrompt(view)) return;
        scope = RastaPrompt;
    } else if (isTranscriptView(view)) scope = RastaTranscript;
    NSTextStorage *storage = view.textStorage;
    if (!storage) return;
    RastaMessageStyle *style = objc_getAssociatedObject(storage, &styleKey);
    if (!style) {
        style = [RastaMessageStyle new];
        style.storage = storage;
        style.source = [storage mutableCopy];
        style.displayed = [storage copy];
        objc_setAssociatedObject(storage, &styleKey, style, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    style.view = view;
    if (style.scope != scope) {
        style.scope = scope;
        style.revision = 0;
    }
    if (storage.delegate != style) {
        // The vendor can replace the delegate and edit before the next refresh.
        // Rebase on that content before comparing attributes or reusing response ranges.
        if (![storage isEqualToAttributedString:style.displayed]) {
            style.source = [storage mutableCopy];
            style.displayed = [storage copy];
            [style.directions removeAllObjects];
            style.revision = 0;
        }
        style.vendorDelegate = storage.delegate;
        storage.delegate = style;
    }
    [style refresh];
}

// The unified transcript stores multiple turns in one view. Its tagged prompts
// delimit response ranges, so changing one response keeps other turns intact.
static NSRange responseRangeAtIndex(RastaMessageStyle *style, NSUInteger index) {
    NSAttributedString *source = style.source;
    if (index >= source.length || [source attribute:userPromptAttribute atIndex:index effectiveRange:NULL]
        || [source attribute:NSAttachmentAttributeName atIndex:index effectiveRange:NULL]) return NSMakeRange(NSNotFound, 0);
    if (style.scope == RastaMessage) {
        __block BOOL containsPrompt = NO;
        [source enumerateAttribute:userPromptAttribute inRange:NSMakeRange(0, source.length) options:0
            usingBlock:^(id value, NSRange range, BOOL *stop) { if (value) { containsPrompt = YES; *stop = YES; } }];
        return containsPrompt ? NSMakeRange(NSNotFound, 0) : NSMakeRange(0, source.length);
    }
    if (style.scope != RastaTranscript) return NSMakeRange(NSNotFound, 0);
    NSRange range;
    [source attribute:userPromptAttribute atIndex:index longestEffectiveRange:&range inRange:NSMakeRange(0, source.length)];
    // With no tagged prompt there is no safe way to identify individual turns.
    return range.length == source.length ? NSMakeRange(NSNotFound, 0) : range;
}

BOOL RastaGeminiResponseDirection(NSTextView *view, NSUInteger index, NSRange *range, BOOL *rtl, BOOL *overridden) {
    if (!view.textStorage || view.isEditable) return NO;
    pthread_mutex_lock(&settingsLock);
    BOOL active = enabled && selectedFont && !forceDirection;
    pthread_mutex_unlock(&settingsLock);
    if (!active) return NO;
    RastaMessageStyle *style = objc_getAssociatedObject(view.textStorage, &styleKey);
    if (!style || style.view != view) return NO;
    NSRange response = responseRangeAtIndex(style, index);
    if (response.location == NSNotFound) return NO;
    NSNumber *direction = style.directions[@(response.location)];
    *range = response;
    *overridden = direction != nil;
    *rtl = direction ? direction.integerValue == NSWritingDirectionRightToLeft
        : hasRTL([style.source.string substringWithRange:response]);
    return YES;
}

BOOL RastaToggleGeminiResponseDirection(NSTextView *view, NSUInteger index) {
    NSRange range;
    BOOL rtl, overridden;
    if (!RastaGeminiResponseDirection(view, index, &range, &rtl, &overridden)) return NO;
    RastaMessageStyle *style = objc_getAssociatedObject(view.textStorage, &styleKey);
    if (!style.directions) style.directions = [NSMutableDictionary new];
    style.directions[@(range.location)] = @(rtl ? NSWritingDirectionLeftToRight : NSWritingDirectionRightToLeft);
    [style applyStyleDuringEdit:NO];
    return YES;
}

void RastaRefreshGeminiMessageViews(NSView *view) {
    if ([view isKindOfClass:NSTextView.class]) prepareMessageView((NSTextView *)view);
    for (NSView *child in view.subviews) RastaRefreshGeminiMessageViews(child);
}

void RastaInstallGeminiMessageViewHook(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Class type = NSTextView.class;
        SEL selector = @selector(viewDidMoveToWindow);
        Method method = class_getInstanceMethod(type, selector);
        void (*original)(NSTextView *, SEL) = (void *)method_getImplementation(method);
        IMP replacement = imp_implementationWithBlock(^(NSTextView *view) {
            original(view, selector);
            if (view.window) prepareMessageView(view);
        });
        class_replaceMethod(type, selector, replacement, method_getTypeEncoding(method));
    });
}

static NSAttributedString *readingFactoryText(CFAttributedStringRef source, const void *caller) {
    atomic_fetch_add(&factoryCalls, 1);
    NSAttributedString *original = (__bridge NSAttributedString *)source;
    if (!source || !calledByHost(caller)) return original;
    atomic_fetch_add(&hostCalls, 1);
    return readingText(original, RastaCoreText, nil);
}

static CTLineRef readingLine(CFAttributedStringRef source) {
    @autoreleasepool {
        NSAttributedString *text = readingFactoryText(source, __builtin_return_address(0));
        return CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)text);
    }
}

static CTFramesetterRef readingFramesetter(CFAttributedStringRef source) {
    @autoreleasepool {
        NSAttributedString *text = readingFactoryText(source, __builtin_return_address(0));
        return CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)text);
    }
}

__attribute__((used, section("__DATA,__interpose")))
static const struct {
    const void *replacement;
    const void *original;
} factories[] = {
    { (const void *)readingLine, (const void *)CTLineCreateWithAttributedString },
    { (const void *)readingFramesetter, (const void *)CTFramesetterCreateWithAttributedString },
};
