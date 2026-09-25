//
//  ValdiLinuxMain.hpp
//  valdi-linux
//

#pragma once

namespace ValdiLinux {

// Entry point for Linux Valdi applications.
// rootComponentPath: module path of the root Valdi component to mount.
// width/height: initial layout size in logical pixels.
// argc/argv: forwarded from main().
// Returns the process exit code.
int valdiLinuxMain(const char* rootComponentPath, int width, int height, int argc, const char** argv);

} // namespace ValdiLinux
