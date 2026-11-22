#if defined(__arm64__)
.text
.p2align 2
_RastaPromptStringEntry:
    // StringProtocol metadata and witness follow the explicit Swift parameters.
    mov x3, x2
    mov x2, x1
    mov x1, lr
    b _RastaSwiftUIPromptString

.p2align 2
_RastaPromptAttributedEntry:
    mov x1, lr
    b _RastaSwiftUIPromptAttributed

.section __DATA,__interpose,interposing
.p2align 3
.quad _RastaPromptStringEntry
.quad _$s7SwiftUI4TextVyACxcSyRzlufC
.quad _RastaPromptAttributedEntry
.quad _$s7SwiftUI4TextVyAC10Foundation16AttributedStringVcfC
#endif
