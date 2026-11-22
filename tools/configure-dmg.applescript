on run argv
    set mountPath to item 1 of argv
    set mountedFolder to POSIX file mountPath as alias
    set backgroundFile to POSIX file (mountPath & "/.background/install.png") as alias
    tell application "Finder"
        tell folder mountedFolder
            open
            set current view of container window to icon view
            set toolbar visible of container window to false
            set statusbar visible of container window to false
            set bounds of container window to {120, 100, 800, 562}
            set viewOptions to the icon view options of container window
            set arrangement of viewOptions to not arranged
            set icon size of viewOptions to 88
            set text size of viewOptions to 13
            set background picture of viewOptions to backgroundFile
            set position of item "Rasta.app" of container window to {170, 220}
            set position of item "Applications" of container window to {510, 220}
            close
            open
            update without registering applications
            delay 2
            close
        end tell
    end tell
end run
