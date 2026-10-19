#pragma once

namespace ValdiLinux {
// Experimental software-rendered desktop host. The existing headless entry point is unchanged.
int valdiLinuxDesktopMain(const char* componentPath, const char* title, int argc, const char** argv);
}
