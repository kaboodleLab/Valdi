#pragma once

namespace ValdiLinux {

// Opt-in Linux desktop host. SDL owns the window and pumps input while Valdi
// owns the component lifecycle and layout tree.
int valdiLinuxSDLMain(const char* rootComponentPath, int width, int height, int argc, const char** argv);

} // namespace ValdiLinux
